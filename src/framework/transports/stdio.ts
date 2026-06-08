import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";

export async function startStdioTransport(server: McpServer, logger: Logger): Promise<void> {
  logger.info("starting_mcp_stdio_transport");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
