import { createAuthHeaderProvider } from "./framework/auth/token-provider.js";
import { loadConfig, parseCliTransport } from "./framework/config.js";
import { createMcpServer } from "./framework/create-mcp-server.js";
import { createLogger } from "./framework/logger.js";
import { RestClient } from "./framework/rest/rest-client.js";
import { startHttpTransport } from "./framework/transports/http.js";
import { startStdioTransport } from "./framework/transports/stdio.js";
import { createTools } from "./tools/index.js";

async function main(): Promise<void> {
  const transportOverride = parseCliTransport(process.argv);
  const config = loadConfig(transportOverride === undefined ? {} : { transportOverride });
  const logger = createLogger(config);
  const authHeaderProvider = createAuthHeaderProvider(config);
  const restClient = new RestClient({ config, authHeaderProvider, logger });

  const context = {
    config,
    logger,
    restClient,
  };

  const serverFactory = () => createMcpServer({ config, context, tools: createTools(restClient) });

  if (config.transport === "stdio") {
    await startStdioTransport(serverFactory(), logger);
    return;
  }

  await startHttpTransport(serverFactory, config, logger);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`mcp_server_startup_failed: ${message}\n`);
  process.exit(1);
});
