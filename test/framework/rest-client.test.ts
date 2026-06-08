import { createServer, type Server } from "node:http";

import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/framework/config.js";
import { RestClient } from "../../src/framework/rest/rest-client.js";
import type { AuthHeaderProvider } from "../../src/framework/auth/token-provider.js";

let server: Server | undefined;

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = undefined;
  }
});

describe("RestClient", () => {
  it("envia Authorization y parsea JSON", async () => {
    const baseUrl = await startTestServer();
    const config: AppConfig = {
      server: {
        name: "test",
        version: "1.0.0",
      },
      transport: "http",
      http: {
        host: "127.0.0.1",
        port: 3000,
        path: "/mcp",
      },
      logging: {
        level: "fatal",
      },
      api: {
        baseUrl,
        timeoutMs: 1000,
      },
      auth: {
        type: "bearer-env",
        token: "test-token",
      },
      mcpAuth: {
        enabled: false,
      },
    };

    const authHeaderProvider: AuthHeaderProvider = {
      async getHeaders() {
        return { Authorization: "Bearer test-token" };
      },
    };

    const client = new RestClient({
      config,
      authHeaderProvider,
      logger: pino({ level: "silent" }),
    });

    const response = await client.get<{ authenticated: boolean; authorization: string }>("/secure");
    expect(response).toEqual({ authenticated: true, authorization: "Bearer test-token" });
  });
});

async function startTestServer(): Promise<string> {
  server = createServer((request, response) => {
    const authorization = request.headers.authorization ?? "";
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        authenticated: authorization === "Bearer test-token",
        authorization,
      }),
    );
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("No se pudo obtener puerto del test server");
  }

  return `http://127.0.0.1:${address.port}`;
}
