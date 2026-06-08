import { describe, expect, it } from "vitest";

import { parseConfig } from "../../src/framework/config.js";

describe("parseConfig", () => {
  it("valida una configuracion minima", () => {
    const config = parseConfig({
      server: {
        name: "demo-mcp",
        version: "1.0.0",
      },
      transport: "http",
      http: {
        host: "127.0.0.1",
        port: 3000,
        path: "/mcp",
      },
      logging: {
        level: "info",
      },
      api: {
        baseUrl: "https://example.com",
        timeoutMs: 5000,
      },
      auth: {
        type: "none",
      },
    });

    expect(config.server.name).toBe("demo-mcp");
    expect(config.transport).toBe("http");
  });
});
