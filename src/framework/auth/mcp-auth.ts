import type { NextFunction, Request, Response } from "express";

import type { AppConfig } from "../config.js";

export function requireMcpAuth(config: AppConfig) {
  return function mcpAuthMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    if (!config.mcpAuth.enabled) {
      next();
      return;
    }

    const expectedToken = config.mcpAuth.token;

    if (expectedToken === undefined || expectedToken.trim() === "") {
      response.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "MCP auth is enabled but MCP_AUTH_TOKEN is not configured",
        },
        id: null,
      });
      return;
    }

    const authorization = request.header("authorization");
    const expectedHeader = `Bearer ${expectedToken}`;

    if (authorization !== expectedHeader) {
      response.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized",
        },
        id: null,
      });
      return;
    }

    next();
  };
}
