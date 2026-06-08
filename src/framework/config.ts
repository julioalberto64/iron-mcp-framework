import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import yaml from "js-yaml";
import * as z from "zod/v4";

dotenv.config();

const LogLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
const TransportSchema = z.enum(["stdio", "http"]);
const AuthTypeSchema = z.enum(["none", "bearer-env", "api-key-env"]);

export const AppConfigSchema = z.object({
  server: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  transport: TransportSchema,
  http: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    path: z.string().startsWith("/"),
  }),
  logging: z.object({
    level: LogLevelSchema,
  }),
  api: z.object({
    baseUrl: z.string().url(),
    timeoutMs: z.number().int().positive(),
  }),
  auth: z.object({
    type: AuthTypeSchema,
    token: z.string().optional(),
    apiKeyHeader: z.string().optional(),
    apiKey: z.string().optional(),
  }),
  mcpAuth: z.object({
    enabled: z.boolean(),
    token: z.string().optional(),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface LoadConfigOptions {
  cwd?: string;
  configFile?: string;
  transportOverride?: "stdio" | "http";
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const cwd = options.cwd ?? process.cwd();
  const configFile = options.configFile ?? path.join(cwd, "config", "default.yaml");
  const fileConfig = readYamlConfig(configFile);

  const envConfig = removeUndefined({
    server: {
      name: process.env.MCP_SERVER_NAME,
      version: process.env.MCP_SERVER_VERSION,
    },
    transport: options.transportOverride ?? process.env.MCP_TRANSPORT,
    http: {
      host: process.env.HTTP_HOST,
      port: parseOptionalInteger(process.env.HTTP_PORT),
      path: process.env.HTTP_PATH,
    },
    logging: {
      level: process.env.LOG_LEVEL,
    },
    api: {
      baseUrl: process.env.API_BASE_URL,
      timeoutMs: parseOptionalInteger(process.env.API_TIMEOUT_MS),
    },
    auth: {
      type: process.env.API_AUTH_TYPE,
      token: process.env.API_TOKEN,
      apiKeyHeader: process.env.API_KEY_HEADER,
      apiKey: process.env.API_KEY,
    },
    mcpAuth: {
      enabled: parseOptionalBoolean(process.env.MCP_AUTH_ENABLED),
      token: process.env.MCP_AUTH_TOKEN,
    },
  });

  return AppConfigSchema.parse(deepMerge(fileConfig, envConfig));
}

export function parseCliTransport(argv: string[]): "stdio" | "http" | undefined {
  const index = argv.indexOf("--transport");
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (value !== "stdio" && value !== "http") {
    throw new Error("--transport debe ser stdio o http");
  }

  return value;
}

export function parseConfig(value: unknown): AppConfig {
  return AppConfigSchema.parse(value);
}

function readYamlConfig(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = yaml.load(raw);

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`El archivo de configuracion no es un objeto YAML valido: ${filePath}`);
  }

  return parsed as Record<string, unknown>;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Valor numerico invalido: ${value}`);
  }

  return parsed;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Valor booleano invalido: ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(left: unknown, right: unknown): unknown {
  if (!isRecord(left) || !isRecord(right)) {
    return right === undefined ? left : right;
  }

  const result: Record<string, unknown> = { ...left };

  for (const [key, value] of Object.entries(right)) {
    result[key] = deepMerge(result[key], value);
  }

  return result;
}

function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(removeUndefined) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      result[key] = removeUndefined(child);
    }
  }

  return result as T;
}
