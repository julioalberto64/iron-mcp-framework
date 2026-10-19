import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../../src/framework/config.js";
import { createMcpServer } from "../../src/framework/create-mcp-server.js";
import { RestClient } from "../../src/framework/rest/rest-client.js";
import { withTimeout } from "../../src/framework/timeout.js";
import { healthTool } from "../../src/tools/health.tool.js";
import type { McpToolDefinition } from "../../src/framework/types.js";

const logger = pino({ level: "silent" });
let upstream: Server | undefined;
let mcp: McpServer | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await mcp?.close();
  if (upstream) {
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      upstream!.close((error) => (error ? reject(error) : resolve())),
    );
  }
  upstream = undefined;
  mcp = undefined;
  client = undefined;
});

it("aborts cooperative work at timeout and prevents later effects", async () => {
  let signal: AbortSignal | undefined;
  let effect = false;
  let stopped = false;
  const result = withTimeout(
    async (executionSignal) => {
      signal = executionSignal;
      try {
        await delay(100, undefined, { signal: executionSignal });
        effect = true;
      } finally {
        stopped = true;
      }
    },
    10,
    "Tool timeout",
  );
  await expect(result).rejects.toThrow("Tool timeout");
  await expect.poll(() => stopped).toBe(true);
  expect(signal?.aborted).toBe(true);
  await delay(110);
  expect(effect).toBe(false);
});

it("does not start work if the parent is already cancelled", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Caller cancelled"));
  const operation = vi.fn().mockResolvedValue(true);
  await expect(withTimeout(operation, 1000, "timeout", controller.signal)).rejects.toThrow(
    "Caller cancelled",
  );
  expect(operation).not.toHaveBeenCalled();
});

it("does not load credentials for an already cancelled REST operation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Caller cancelled"));
  const getHeaders = vi.fn().mockResolvedValue({});
  const config = { api: { baseUrl: "https://trusted.example", timeoutMs: 1000 } } as AppConfig;
  const rest = new RestClient({ config, logger, authHeaderProvider: { getHeaders } });
  await expect(rest.withSignal(controller.signal).get("/review")).rejects.toThrow(
    "Caller cancelled",
  );
  expect(getHeaders).not.toHaveBeenCalled();
});

describe("Tool execution cancellation reaches the real REST stream", () => {
  async function connect(timeoutMs: number) {
    let streamClosed = false;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"pending":');
      response.once("close", () => {
        streamClosed = true;
      });
      markStarted();
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("No upstream port");
    const config: AppConfig = {
      server: { name: "cancellation-test", version: "1.0.0" },
      transport: "stdio",
      http: { host: "127.0.0.1", port: 3000, path: "/mcp" },
      logging: { level: "fatal" },
      api: { baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 5000 },
      auth: { type: "none" },
      mcpAuth: { enabled: false },
    };
    const restClient = new RestClient({
      config,
      logger,
      authHeaderProvider: { getHeaders: () => Promise.resolve({}) },
    });
    let effect = false;
    let stopped = false;
    const tool: McpToolDefinition = {
      ...healthTool,
      name: "slow_tool",
      timeoutMs,
      async handler(_input, context) {
        try {
          await context.restClient.get("/slow");
          effect = true;
          return { ok: true };
        } finally {
          stopped = true;
        }
      },
    };
    mcp = createMcpServer({ config, context: { config, logger, restClient }, tools: [tool] });
    client = new Client({ name: "cancellation-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    await client.connect(clientTransport);
    return {
      started,
      streamClosed: () => streamClosed,
      stopped: () => stopped,
      effect: () => effect,
    };
  }

  it("closes the upstream socket at the tool timeout during response streaming", async () => {
    const state = await connect(200);
    const pending = client!.callTool({ name: "slow_tool", arguments: {} });
    await state.started;
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("TIMEOUT_ERROR");
    await expect.poll(state.streamClosed).toBe(true);
    await expect.poll(state.stopped).toBe(true);
    expect(state.effect()).toBe(false);
  });

  it("propagates MCP caller cancellation to the upstream socket", async () => {
    const state = await connect(3000);
    const controller = new AbortController();
    const pending = client!.callTool({ name: "slow_tool", arguments: {} }, undefined, {
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow();
    await state.started;
    controller.abort(new Error("Caller cancelled"));
    await rejected;
    await expect.poll(state.streamClosed).toBe(true);
    await expect.poll(state.stopped).toBe(true);
    expect(state.effect()).toBe(false);
  });
});
