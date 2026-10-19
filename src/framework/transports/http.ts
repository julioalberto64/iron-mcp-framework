import type { Server } from "node:http";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import { requireMcpAuth } from "../auth/mcp-auth.js";

import type { AppConfig } from "../config.js";
import { toSafeErrorMessage } from "../errors.js";

export async function startHttpTransport(
  serverFactory: () => McpServer,
  config: AppConfig,
  logger: Logger,
): Promise<Server> {
  const app = createMcpExpressApp({
    host: config.http.host,
    ...(config.http.allowedHosts === undefined
      ? {}
      : {
          allowedHosts: ["localhost", "127.0.0.1", "[::1]", ...config.http.allowedHosts],
        }),
  });

  app.use(config.http.path, requireMcpAuth(config));

  let activeRequests = 0;

  app.get("/healthz", (_request: Request, response: Response) => {
    response.json({
      ok: true,
      server: config.server.name,
      version: config.server.version,
    });
  });

  app.post(config.http.path, (request: Request, response: Response) => {
    if (activeRequests >= 100) {
      response.status(503).json({ error: "Too many active MCP requests" });
      return;
    }
    activeRequests += 1;
    void handleMcpPost(request, response, serverFactory, logger).finally(() => {
      activeRequests -= 1;
    });
  });

  app.get(config.http.path, (_request: Request, response: Response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. Use POST for this MCP endpoint.",
      },
      id: null,
    });
  });

  app.delete(config.http.path, (_request: Request, response: Response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(config.http.port, config.http.host, () => {
      logger.info(
        {
          host: config.http.host,
          port: config.http.port,
          path: config.http.path,
        },
        "mcp_http_transport_started",
      );

      resolve(httpServer);
    });

    httpServer.on("error", reject);
  });
}

async function handleMcpPost(
  request: Request,
  response: Response,
  serverFactory: () => McpServer,
  logger: Logger,
): Promise<void> {
  let server: McpServer | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= server?.close() ?? Promise.resolve();
    return cleanupPromise;
  };
  const onClose = (): void => {
    void cleanup().catch((error: unknown) => {
      logger.error({ error: toSafeErrorMessage(error) }, "mcp_http_cleanup_failed");
    });
  };
  const deadline = setTimeout(() => response.destroy(), 30000);
  response.once("close", onClose);
  try {
    server = serverFactory();
    const transport = new StreamableHTTPServerTransport();
    // SDK optional callbacks are incompatible with exactOptionalPropertyTypes.
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    logger.error(
      {
        error: toSafeErrorMessage(error),
      },
      "mcp_http_request_failed",
    );

    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  } finally {
    clearTimeout(deadline);
    response.off("close", onClose);
    await cleanup().catch((error: unknown) => {
      logger.error({ error: toSafeErrorMessage(error) }, "mcp_http_cleanup_failed");
    });
  }
}
