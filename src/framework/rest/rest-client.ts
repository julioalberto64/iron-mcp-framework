import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { ApiError, TimeoutError } from "../errors.js";
import type { AuthHeaderProvider } from "../auth/token-provider.js";

export interface RestClientOptions {
  config: AppConfig;
  authHeaderProvider: AuthHeaderProvider;
  logger: Logger;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export class RestClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly authHeaderProvider: AuthHeaderProvider;
  private readonly logger: Logger;

  public constructor(options: RestClientOptions) {
    this.baseUrl = new URL(options.config.api.baseUrl);
    this.timeoutMs = options.config.api.timeoutMs;
    this.authHeaderProvider = options.authHeaderProvider;
    this.logger = options.logger;
  }

  public async get<T>(pathName: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", pathName, options);
  }

  public async post<T>(pathName: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", pathName, { ...options, body });
  }

  private async request<T>(method: string, pathName: string, options: RequestOptions): Promise<T> {
    const url = new URL(pathName, this.baseUrl);
    const authHeaders = await this.authHeaderProvider.getHeaders();
    const extraHeaders = options.headers ?? {};
    const headers = removeSensitiveHeaders({
      Accept: "application/json",
      ...authHeaders,
      ...extraHeaders,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    this.logger.debug({ method, url: url.toString() }, "rest_request_started");

    try {
      const requestInit: RequestInit = {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...authHeaders,
          ...extraHeaders,
        },
        signal: controller.signal,
      };

      if (options.body !== undefined) {
        requestInit.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, requestInit);

      const text = await response.text();
      this.logger.debug(
        { method, status: response.status, url: url.toString(), headers },
        "rest_request_finished",
      );

      if (!response.ok) {
        throw new ApiError(`REST API respondio con status ${response.status}`, response.status, {
          method,
          url: url.toString(),
          response: parseMaybeJson(text),
        });
      }

      return parseMaybeJson(text) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError("REST API timeout", {
          method,
          url: url.toString(),
          timeoutMs: options.timeoutMs ?? this.timeoutMs,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseMaybeJson(text: string): unknown {
  if (text.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function removeSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const safeHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    safeHeaders[key] =
      normalized === "authorization" || normalized.includes("key") ? "[REDACTED]" : value;
  }

  return safeHeaders;
}
