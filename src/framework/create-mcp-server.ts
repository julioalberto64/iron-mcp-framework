import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { AppConfig } from "./config.js";
import { toSafeErrorMessage } from "./errors.js";
import type { McpToolDefinition, ToolExecutionContext } from "./types.js";

import { withTimeout } from "./timeout.js";

export interface CreateMcpServerOptions {
  config: AppConfig;
  context: ToolExecutionContext;
  tools: McpToolDefinition[];
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: options.config.server.name,
      version: options.config.server.version,
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  for (const tool of options.tools) {
    const toolOptions = {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    };

    server.registerTool(tool.name, toolOptions, async (input, extra): Promise<CallToolResult> => {
      const startedAt = Date.now();
      options.context.logger.info(
        {
          tool: tool.name,
          audit: tool.audit,
          auth: tool.auth.required ? "required" : "not_required",
        },
        "mcp_tool_started",
      );

      try {
        await server.sendLoggingMessage(
          {
            level: "info",
            data: `Tool started: ${tool.name}`,
          },
          extra.sessionId,
        );

        const output = await withTimeout(
          tool.handler(input as Record<string, unknown>, options.context),
          tool.timeoutMs,
          `Tool ${tool.name} excedio timeout de ${tool.timeoutMs}ms`,
        );

        const durationMs = Date.now() - startedAt;
        options.context.logger.info({ tool: tool.name, durationMs }, "mcp_tool_completed");

        const result: CallToolResult = {
          content: [
            {
              type: "text",
              text: formatToolOutput(output),
            },
          ],
        };

        if (isRecord(output)) {
          result.structuredContent = output;
        }

        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        options.context.logger.error(
          { tool: tool.name, durationMs, error: toSafeErrorMessage(error) },
          "mcp_tool_failed",
        );

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: toSafeErrorMessage(error),
            },
          ],
        };
      }
    });
  }

  return server;
}

function formatToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  return JSON.stringify(output, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
