import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { ApiError, ConfigError, TimeoutError } from "../errors.js";
import type { AuthHeaderProvider } from "../auth/token-provider.js";

export interface RestClientOptions {
  config: AppConfig;
  authHeaderProvider: AuthHeaderProvider;
  logger: Logger;
}

export interface RequestOptions {
  /** Destinos públicos fijos; nunca reciben credenciales de la API configurada. */
  service?: "weather-geocoding" | "weather-current";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class RestClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly authHeaderProvider: AuthHeaderProvider;
  private readonly logger: Logger;

  public constructor(
    private readonly options: RestClientOptions,
    private readonly signal?: AbortSignal,
  ) {
    this.baseUrl = new URL(options.config.api.baseUrl);
    if (
      !["http:", "https:"].includes(this.baseUrl.protocol) ||
      this.baseUrl.username ||
      this.baseUrl.password
    ) {
      throw new ConfigError("API base URL debe ser HTTP(S) y no incluir credenciales");
    }
    this.timeoutMs = options.config.api.timeoutMs;
    this.authHeaderProvider = options.authHeaderProvider;
    this.logger = options.logger;
  }

  public withSignal(signal: AbortSignal): RestClient {
    return new RestClient(
      this.options,
      this.signal === undefined ? signal : AbortSignal.any([this.signal, signal]),
    );
  }

  public async get<T>(pathName: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", pathName, options);
  }

  public async post<T>(pathName: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", pathName, { ...options, body });
  }

  private async request<T>(method: string, pathName: string, options: RequestOptions): Promise<T> {
    const publicServices = {
      "weather-geocoding": "https://geocoding-api.open-meteo.com/v1/search",
      "weather-current": "https://api.open-meteo.com/v1/forecast",
    } as const;
    const serviceUrl = options.service === undefined ? undefined : publicServices[options.service];
    if (options.service !== undefined && serviceUrl === undefined) {
      throw new ConfigError("Servicio REST no permitido");
    }
    const baseUrl = serviceUrl === undefined ? this.baseUrl : new URL(serviceUrl);
    if (
      /^[a-z][a-z\d+.-]*:/iu.test(pathName) ||
      pathName.startsWith("//") ||
      /[\\\s]/u.test(pathName) ||
      [...pathName].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    ) {
      throw new ApiError("La ruta REST debe ser relativa al origen configurado", 400);
    }
    const url = new URL(pathName, baseUrl);
    if (url.origin !== baseUrl.origin || url.username || url.password) {
      throw new ApiError("Destino REST no permitido", 400);
    }
    if (serviceUrl !== undefined && (method !== "GET" || url.pathname !== baseUrl.pathname)) {
      throw new ApiError("Operacion no permitida para el servicio publico", 400);
    }
    const extraHeaders = options.headers ?? {};
    if (serviceUrl !== undefined && Object.keys(extraHeaders).length > 0) {
      throw new ApiError("El servicio publico no admite headers adicionales", 400);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new TimeoutError("REST API timeout")),
      options.timeoutMs ?? this.timeoutMs,
    );
    const signal = AbortSignal.any([
      controller.signal,
      ...(this.signal === undefined ? [] : [this.signal]),
      ...(options.signal === undefined ? [] : [options.signal]),
    ]);

    this.logger.debug({ method, origin: url.origin }, "rest_request_started");

    try {
      signal.throwIfAborted();
      const authHeaders =
        serviceUrl === undefined ? await this.authHeaderProvider.getHeaders() : {};
      signal.throwIfAborted();
      const requestInit: RequestInit = {
        method,
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...authHeaders,
          ...extraHeaders,
        },
        signal,
      };

      if (options.body !== undefined) {
        requestInit.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, requestInit);

      const text = await readLimitedBody(response);
      signal.throwIfAborted();
      this.logger.debug(
        { method, status: response.status, origin: url.origin },
        "rest_request_finished",
      );

      if (!response.ok) {
        throw new ApiError(`REST API respondio con status ${response.status}`, response.status, {
          method,
          origin: url.origin,
          response: parseMaybeJson(text),
        });
      }

      return parseMaybeJson(text) as T;
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

async function readLimitedBody(response: Response): Promise<string> {
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new ApiError("Respuesta REST excede el limite de 2 MiB", 502);
  }
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError("Respuesta REST excede el limite de 2 MiB", 502);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
