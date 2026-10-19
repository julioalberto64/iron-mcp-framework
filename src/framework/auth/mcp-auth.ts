import { createHash, timingSafeEqual } from "node:crypto";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { NextFunction, Request, Response } from "express";

import type { AppConfig } from "../config.js";

export function requireMcpAuth(config: AppConfig) {
  const windowMs = 60000;
  const maxFailures = 10;
  const maxClients = 1024;
  const failures = new Map<string, { count: number; expiresAt: number }>();
  let nextSweepAt = 0;
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

    if (
      expectedToken === undefined ||
      expectedToken.length < 32 ||
      expectedToken.length > 256 ||
      /[^!-~]/u.test(expectedToken)
    ) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message:
            "MCP auth requires a random MCP_AUTH_TOKEN of 32 to 256 ASCII characters without spaces",
        },
        id: null,
      });
      return;
    }

    const now = Date.now();
    if (now >= nextSweepAt || failures.size >= maxClients) {
      for (const [key, entry] of failures) {
        if (entry.expiresAt <= now) failures.delete(key);
      }
      nextSweepAt = now + windowMs;
    }
    // Use the socket address; client-supplied forwarding headers cannot reset the limit.
    const clientAddress = request.socket.remoteAddress ?? "unknown";
    let failure = failures.get(clientAddress);
    if (failure !== undefined && failure.expiresAt <= now) {
      failures.delete(clientAddress);
      failure = undefined;
    }
    if (
      (failure !== undefined && failure.count >= maxFailures) ||
      (failure === undefined && failures.size >= maxClients)
    ) {
      const expiresAt =
        failure?.expiresAt ?? Math.min(...[...failures.values()].map((entry) => entry.expiresAt));
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((expiresAt - now) / 1000))));
      response.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Too many authentication attempts" },
        id: null,
      });
      return;
    }

    const authorization = request.header("authorization");
    const expectedHeader = `Bearer ${expectedToken}`;

    if (
      authorization === undefined ||
      !timingSafeEqual(
        createHash("sha256").update(authorization).digest(),
        createHash("sha256").update(expectedHeader).digest(),
      )
    ) {
      failures.set(clientAddress, {
        count: (failure?.count ?? 0) + 1,
        expiresAt: failure?.expiresAt ?? now + windowMs,
      });
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

    failures.delete(clientAddress);
    (request as Request & { auth?: AuthInfo }).auth = {
      token: expectedToken,
      clientId: "configured-token",
      scopes: config.mcpAuth.scopes ?? [],
    };
    next();
  };
}
