import pino from "pino";

import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig): pino.Logger {
  const options: pino.LoggerOptions = {
    level: config.logging.level,
    base: {
      service: config.server.name,
      version: config.server.version,
      transport: config.transport,
    },
  };

  if (config.transport === "stdio") {
    return pino(options, process.stderr);
  }

  return pino(options);
}
