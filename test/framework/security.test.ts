import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { get as httpGet, type Server } from "node:http";

import { parseConfig, type AppConfig } from "../../src/framework/config.js";
import { createMcpServer } from "../../src/framework/create-mcp-server.js";
import { RestClient } from "../../src/framework/rest/rest-client.js";
import { startHttpTransport } from "../../src/framework/transports/http.js";
import { defineTool } from "../../src/framework/types.js";
import { callSecureApiTool } from "../../src/tools/call-secure-api.tool.js";
import { healthTool } from "../../src/tools/health.tool.js";

const TEST_MCP_TOKEN = "test-only-token-".repeat(4);
const logger = pino({ level: "silent" });
function makeConfig(): AppConfig {
  return {
    server: { name: "security-test", version: "1.0.0" },
    transport: "http",
    http: { host: "127.0.0.1", port: 0, path: "/mcp" },
    logging: { level: "fatal" },
    api: { baseUrl: "https://trusted.example/api/", timeoutMs: 1000 },
    auth: { type: "none" },
    mcpAuth: { enabled: true, token: TEST_MCP_TOKEN, scopes: ["billing:read"] },
  };
}
const servers: Server[] = [];
const clients: Client[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

describe("Secure configuration", () => {
  it("requires a token when HTTP authentication is enabled", () => {
    const config = makeConfig();
    config.http.port = 3000;
    delete config.mcpAuth.token;
    expect(() => parseConfig(config)).toThrow("MCP_AUTH_TOKEN");
    config.transport = "stdio";
    expect(() => parseConfig(config)).not.toThrow();
  });
  it.each(["short", "x".repeat(257), "x".repeat(32) + " "])(
    "rejects an invalid HTTP token",
    (token) => {
      const config = makeConfig();
      config.http.port = 3000;
      config.mcpAuth.token = token;
      expect(() => parseConfig(config)).toThrow("MCP_AUTH_TOKEN");
    },
  );
  it.each([
    "https://tunnel.example.test",
    "tunnel.example.test/mcp",
    "tunnel.example.test:3000",
    "*.devtunnels.ms",
    "user@tunnel.example.test",
  ])("rejects invalid allowed hostname %s", (hostname) => {
    const config = makeConfig();
    config.http.port = 3000;
    config.http.allowedHosts = [hostname];
    expect(() => parseConfig(config)).toThrow("HTTP_ALLOWED_HOSTS");
  });

  it.each(["file:///etc/passwd", "https://user:password@api.example"])(
    "rejects API URL %s",
    (baseUrl) => {
      const config = makeConfig();
      config.http.port = 3000;
      config.api.baseUrl = baseUrl;
      expect(() => parseConfig(config)).toThrow();
    },
  );
});

describe("REST security", () => {
  it.each([
    "https://attacker.example/collect",
    "//attacker.example/collect",
    "\\\\attacker.example/collect",
    "/\\attacker.example/collect",
    " https://attacker.example",
    "\n//attacker.example",
    "http://127.0.0.1/admin",
  ])("rejects untrusted destination %j before loading credentials", async (path) => {
    const getHeaders = vi.fn().mockResolvedValue({ Authorization: "Bearer fake-review-token" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new RestClient({
      config: makeConfig(),
      logger,
      authHeaderProvider: { getHeaders },
    });
    await expect(client.get(path)).rejects.toThrow();
    expect(getHeaders).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends credentials only to the configured origin and disables redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RestClient({
      config: makeConfig(),
      logger,
      authHeaderProvider: {
        getHeaders: () => Promise.resolve({ Authorization: "Bearer fake-review-token" }),
      },
    });
    await expect(client.get("/bearer")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://trusted.example/bearer"),
      expect.objectContaining({
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer fake-review-token",
        },
      }),
    );
  });

  it("limits chunked responses even without Content-Length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1))),
    );
    const client = new RestClient({
      config: makeConfig(),
      logger,
      authHeaderProvider: { getHeaders: () => Promise.resolve({}) },
    });
    await expect(client.get("/large")).rejects.toThrow("2 MiB");
  });

  it("restricts the demo tool to its declared endpoint", async () => {
    const get = vi.fn();
    await expect(
      callSecureApiTool.handler(
        { path: "/admin" },
        {
          config: makeConfig(),
          logger,
          restClient: { get } as unknown as RestClient,
        },
      ),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("HTTP authentication and stateless lifecycle", () => {
  async function start(config: AppConfig) {
    const closed: Array<() => boolean> = [];
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const protectedTool = defineTool({
      ...healthTool,
      name: "protected_review",
      auth: { required: true, scopes: ["billing:read"] },
      outputSchema: { ok: healthTool.outputSchema!.ok! },
      handler,
    });
    const context = {
      config,
      logger,
      restClient: new RestClient({
        config,
        logger,
        authHeaderProvider: { getHeaders: () => Promise.resolve({}) },
      }),
    };
    const server = await startHttpTransport(
      () => {
        const mcp = createMcpServer({ config, context, tools: [healthTool, protectedTool] });
        const spy = vi.spyOn(mcp, "close");
        closed.push(() => spy.mock.calls.length > 0);
        return mcp;
      },
      config,
      logger,
    );
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No HTTP port");
    return {
      url: new URL(`http://127.0.0.1:${address.port}/mcp`),
      handler,
      allClosed: () => closed.every((isClosed) => isClosed()),
    };
  }
  async function connect(url: URL, token?: string) {
    const client = new Client({ name: "security-review", version: "1.0.0" });
    clients.push(client);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    return { client, transport };
  }

  it("allows only the explicitly configured tunnel hostname and localhost", async () => {
    const config = makeConfig();
    config.http.allowedHosts = ["approved.example.test"];
    const { url } = await start(config);
    async function status(host: string): Promise<number> {
      return new Promise((resolve, reject) => {
        const request = httpGet(
          new URL("/healthz", url),
          { headers: { Host: host } },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        request.on("error", reject);
      });
    }
    expect(await status("approved.example.test")).toBe(200);
    expect(await status("127.0.0.1")).toBe(200);
    expect(await status("attacker.example.test")).toBe(403);
    expect(await status("approved.example.test.attacker.example")).toBe(403);
  });

  it("rejects absent and invalid bearer tokens", async () => {
    const { url, handler } = await start(makeConfig());
    for (const headers of [{}, { Authorization: "Bearer wrong" }]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
      });
      expect(response.status).toBe(401);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("limits failures, ignores forwarded IP spoofing, and recovers after the window", async () => {
    const { url, handler } = await start(makeConfig());
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    for (let i = 0; i < 10; i += 1) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong",
          "X-Forwarded-For": `192.0.2.${i}`,
        },
        body: "{}",
      });
      expect(response.status).toBe(401);
      await response.text();
    }
    const blocked = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_MCP_TOKEN}`,
        "X-Forwarded-For": "198.51.100.1",
      },
      body: "{}",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    await blocked.text();
    expect(handler).not.toHaveBeenCalled();
    clock.mockReturnValue(now + 60001);
    const { client } = await connect(url, TEST_MCP_TOKEN);
    const result = await client.callTool({ name: "protected_review", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("authorizes scopes across successive requests without retaining sessions", async () => {
    const { url, handler, allClosed } = await start(makeConfig());
    const { client, transport } = await connect(url, TEST_MCP_TOKEN);
    expect(transport.sessionId).toBeUndefined();
    for (let i = 0; i < 2; i += 1) {
      const result = await client.callTool({ name: "protected_review", arguments: {} });
      expect(result.isError).not.toBe(true);
    }
    expect(handler).toHaveBeenCalledTimes(2);
    await expect.poll(allClosed).toBe(true);
  });

  it.each([true, false])(
    "denies protected handlers without scopes (auth enabled=%s)",
    async (enabled) => {
      const config = makeConfig();
      config.mcpAuth = { ...config.mcpAuth, enabled, scopes: [] };
      const { url, handler } = await start(config);
      const { client } = await connect(url, enabled ? TEST_MCP_TOKEN : undefined);
      const result = await client.callTool({ name: "protected_review", arguments: {} });
      expect(result.isError).toBe(true);
      expect(handler).not.toHaveBeenCalled();
      const health = await client.callTool({ name: "health_check", arguments: {} });
      expect(health.isError).not.toBe(true);
    },
  );
});
