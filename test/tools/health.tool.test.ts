import pino from "pino";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/framework/config.js";
import type { RestClient } from "../../src/framework/rest/rest-client.js";
import { healthTool } from "../../src/tools/health.tool.js";

const config: AppConfig = {
  server: {
    name: "test-mcp",
    version: "1.0.0",
  },
  transport: "stdio",
  http: {
    host: "127.0.0.1",
    port: 3000,
    path: "/mcp",
  },
  logging: {
    level: "fatal",
  },
  api: {
    baseUrl: "https://example.com",
    timeoutMs: 1000,
  },
  auth: {
    type: "none",
  },
  mcpAuth: {
    enabled: false,
  },
};

describe("healthTool", () => {
  it("devuelve informacion basica del servidor", async () => {
    const result = await healthTool.handler(
      { echo: "hola" },
      {
        config,
        logger: pino({ level: "silent" }),
        restClient: {} as RestClient,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      server: "test-mcp",
      version: "1.0.0",
      transport: "stdio",
      echo: "hola",
    });
  });
});
