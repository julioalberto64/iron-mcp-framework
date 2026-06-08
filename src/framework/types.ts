import type { Logger } from "pino";
import type * as z from "zod/v4";

import type { AppConfig } from "./config.js";
import type { RestClient } from "./rest/rest-client.js";

export type ToolCategory = "read" | "write" | "delete" | "external-api" | "system";

export type ToolAuthRequirement =
  | {
      required: false;
    }
  | {
      required: true;
      scopes: string[];
    };

export interface ToolAuditMetadata {
  category: ToolCategory;
  pii: boolean;
}

export interface ToolExecutionContext {
  config: AppConfig;
  logger: Logger;
  restClient: RestClient;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  timeoutMs: number;
  idempotent: boolean;
  auth: ToolAuthRequirement;
  audit: ToolAuditMetadata;
  handler(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}

export function defineTool(tool: McpToolDefinition): McpToolDefinition {
  return tool;
}
