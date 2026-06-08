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
  const app = createMcpExpressApp({ host: config.http.host });

  app.use(config.http.path, requireMcpAuth(config));

  const transports = new Map<
    string,
    {
      server: McpServer;
      transport: StreamableHTTPServerTransport;
    }
  >();

  app.get("/healthz", (_request: Request, response: Response) => {
    response.json({
      ok: true,
      server: config.server.name,
      version: config.server.version,
    });
  });

  app.post(config.http.path, (request: Request, response: Response) => {
    void handleMcpPost(request, response, serverFactory, transports, logger);
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
  transports: Map<
    string,
    {
      server: McpServer;
      transport: StreamableHTTPServerTransport;
    }
  >,
  logger: Logger,
): Promise<void> {
  try {
    const sessionId = request.header("mcp-session-id");

    let server: McpServer;
    let transport: StreamableHTTPServerTransport;

    if (sessionId !== undefined && transports.has(sessionId)) {
      const existing = transports.get(sessionId);

      if (existing === undefined) {
        throw new Error("MCP session not found");
      }

      server = existing.server;
      transport = existing.transport;
    } else {
      server = serverFactory();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => Math.random().toString(36).slice(2),
        onsessioninitialized: (newSessionId: string) => {
          transports.set(newSessionId, {
            server,
            transport,
          });
        },
      });

      if (typeof transport.onclose !== "function") {
        (
          transport as unknown as {
            onclose: () => void;
          }
        ).onclose = () => {
          // noop
        };
      }

      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    }

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
  }
}
