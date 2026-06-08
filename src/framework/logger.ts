import pino, { type Logger } from "pino";

import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig): Logger {
  const options = {
    level: config.logging.level,
    base: {
      service: config.server.name,
      version: config.server.version,
      transport: config.transport,
    },
  };

  if (config.transport === "stdio") {
    return pino(options, pino.destination(2));
  }

  return pino(options);
}
