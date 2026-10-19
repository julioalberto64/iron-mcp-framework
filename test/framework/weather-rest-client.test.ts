import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../../src/framework/config.js";
import { RestClient, type RequestOptions } from "../../src/framework/rest/rest-client.js";

function setup() {
  const getHeaders = vi.fn().mockResolvedValue({ Authorization: "Bearer fictional-token" });
  const config = {
    api: { baseUrl: "https://internal.example.test", timeoutMs: 1000 },
  } as AppConfig;
  const client = new RestClient({
    config,
    logger: pino({ level: "silent" }),
    authHeaderProvider: { getHeaders },
  });
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  return { client, getHeaders, fetchMock };
}
afterEach(() => vi.unstubAllGlobals());

describe("REST para Open-Meteo", () => {
  it.each([
    ["weather-geocoding", "/v1/search?name=Villa", "https://geocoding-api.open-meteo.com"],
    ["weather-current", "/v1/forecast?latitude=14&longitude=-90", "https://api.open-meteo.com"],
  ] as const)("usa el destino fijo %s sin cargar credenciales", async (service, path, origin) => {
    const { client, getHeaders, fetchMock } = setup();
    await client.get(path, { service });
    expect(getHeaders).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect((url as URL).origin).toBe(origin);
    expect(init?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(init?.redirect).toBe("error");
  });
  it.each([
    "https://evil.example/v1/search",
    "//evil.example/v1/search",
    "/other",
    "/v1/search/../other",
  ])("rechaza otras rutas %s", async (path) => {
    const { client, fetchMock } = setup();
    await expect(client.get(path, { service: "weather-geocoding" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rechaza escrituras, servicios desconocidos y headers adicionales", async () => {
    const { client, fetchMock } = setup();
    await expect(client.post("/v1/search", {}, { service: "weather-geocoding" })).rejects.toThrow();
    await expect(
      client.get("/v1/search", { service: "unknown" } as unknown as RequestOptions),
    ).rejects.toThrow();
    await expect(
      client.get("/v1/search", {
        service: "weather-geocoding",
        headers: { Authorization: "fictional" },
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("conserva el origen y la autenticación de la API existente", async () => {
    const { client, fetchMock, getHeaders } = setup();
    await client.get("/v1/search", { service: "weather-geocoding" });
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await client.get("/internal");
    expect(getHeaders).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[1]?.[0] as URL).origin).toBe("https://internal.example.test");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer fictional-token",
    );
  });
  it("propaga la cancelación de la ejecución a fetch", async () => {
    const { client, fetchMock } = setup();
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    fetchMock.mockImplementation(
      (_url, init: RequestInit = {}) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("Cancelado")), {
            once: true,
          });
          started();
        }),
    );
    const pending = client
      .withSignal(controller.signal)
      .get("/v1/forecast", { service: "weather-current" });
    const rejected = expect(pending).rejects.toThrow("Cancelado");
    await ready;
    controller.abort(new Error("Cancelado"));
    await rejected;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
