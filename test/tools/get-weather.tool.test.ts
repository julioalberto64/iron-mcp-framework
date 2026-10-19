import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../../src/framework/create-mcp-server.js";
import { parseConfig } from "../../src/framework/config.js";
import type { RestClient } from "../../src/framework/rest/rest-client.js";
import { getWeatherTool } from "../../src/tools/get-weather.tool.js";
import { createTools } from "../../src/tools/index.js";

const location = {
  id: 101,
  name: "Villa Ejemplo",
  country: "País Ficticio",
  country_code: "GT",
  admin1: "Región Demo",
  latitude: 14.5,
  longitude: -90.5,
};
const weather = {
  current_units: { temperature_2m: "°C", apparent_temperature: "°C" },
  current: { temperature_2m: 21.5, apparent_temperature: 23.1, weather_code: 2 },
};
function setup(results = [location]) {
  const config = parseConfig({
    server: { name: "test", version: "1.0.0" },
    transport: "stdio",
    http: { host: "127.0.0.1", port: 3000, path: "/mcp" },
    logging: { level: "fatal" },
    api: { baseUrl: "https://private.example.test", timeoutMs: 1000 },
    auth: { type: "none" },
    mcpAuth: { enabled: false },
  });
  const get = vi.fn().mockResolvedValueOnce({ results }).mockResolvedValueOnce(weather);
  const controller = new AbortController();
  const context = {
    config,
    logger: pino({ level: "silent" }),
    restClient: {
      get,
      withSignal() {
        return this;
      },
    } as unknown as RestClient,
    signal: controller.signal,
  };
  return { get, context, controller };
}
afterEach(() => vi.unstubAllGlobals());

describe("get_weather", () => {
  it("se registra con weather:read", () => {
    expect(createTools()).toContain(getWeatherTool);
    expect(getWeatherTool.auth).toEqual({ required: true, scopes: ["weather:read"] });
  });
  it("consulta ciudad y coordenadas, devuelve °C y una descripción en español", async () => {
    const { get, context } = setup();
    await expect(
      getWeatherTool.handler({ city: " Villa Ejemplo ", countryCode: "gt" }, context),
    ).resolves.toEqual({
      result: {
        status: "ok",
        city: location.name,
        country: location.country,
        temperatureC: 21.5,
        feelsLikeC: 23.1,
        description: "Parcialmente nublado",
      },
      attribution: "Weather data by Open-Meteo (https://open-meteo.com/), CC BY 4.0",
    });
    expect(get).toHaveBeenNthCalledWith(
      1,
      "/v1/search?name=Villa+Ejemplo&count=100&language=es&format=json&countryCode=GT",
      { service: "weather-geocoding" },
    );
    expect(get).toHaveBeenNthCalledWith(
      2,
      "/v1/forecast?latitude=14.5&longitude=-90.5&current=temperature_2m%2Capparent_temperature%2Cweather_code&temperature_unit=celsius",
      { service: "weather-current" },
    );
  });
  it.each([
    {},
    { city: "" },
    { city: " " },
    { city: 5 },
    { city: "x" },
    { city: "x".repeat(121) },
    { city: "https://evil.test" },
    { city: "Villa\nEjemplo" },
    { city: "Villa Ejemplo", countryCode: "GTM" },
    { city: "Villa Ejemplo", locationId: -1 },
    { city: "Villa Ejemplo", url: "https://evil.test" },
  ])("rechaza entrada inválida %j sin llamar REST", async (input) => {
    const { get, context } = setup();
    await expect(getWeatherTool.handler(input, context)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it("pide precisión entre ciudades homónimas del mismo país sin consultar el clima", async () => {
    const { get, context } = setup([location, { ...location, id: 102, admin1: "Otra Región" }]);
    const output = await getWeatherTool.handler({ city: location.name }, context);
    expect(output).toMatchObject({
      result: {
        status: "needs_clarification",
        truncated: false,
        candidates: [{ locationId: 101 }, { locationId: 102 }],
      },
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("usa el locationId elegido y sus coordenadas", async () => {
    const { get, context } = setup([location, { ...location, id: 102, latitude: 20 }]);
    await getWeatherTool.handler({ city: location.name, locationId: 102 }, context);
    expect(get.mock.calls[1]?.[0]).toContain("latitude=20&");
  });
  it("filtra por país sin elegir arbitrariamente", async () => {
    const { get, context } = setup([location, { ...location, id: 102, country_code: "MX" }]);
    await getWeatherTool.handler({ city: location.name, countryCode: "GT" }, context);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("no trata coincidencias por prefijo como la ciudad solicitada", async () => {
    const { get, context } = setup([{ ...location, name: "Villa Ejemplo Grande" }]);
    await expect(getWeatherTool.handler({ city: location.name }, context)).rejects.toThrow(
      "No se encontró",
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("no resuelve automáticamente una búsqueda truncada", async () => {
    const { get, context } = setup(
      Array.from({ length: 100 }, (_, i) => ({ ...location, id: i + 1 })),
    );
    await expect(getWeatherTool.handler({ city: location.name }, context)).resolves.toMatchObject({
      result: { status: "needs_clarification", truncated: true },
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { results: [] }])("maneja ciudades ausentes: %j", async (response) => {
    const { get, context } = setup();
    get.mockReset().mockResolvedValue(response);
    await expect(getWeatherTool.handler({ city: location.name }, context)).rejects.toThrow(
      "No se encontró",
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
  it.each([{ results: null }, { results: [{ ...location, latitude: 100 }] }, { error: true }])(
    "rechaza geocodificación inválida o fallida %j",
    async (response) => {
      const { get, context } = setup();
      get.mockReset().mockResolvedValue(response);
      await expect(getWeatherTool.handler({ city: location.name }, context)).rejects.toThrow();
      expect(get).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    {},
    { ...weather, current: { ...weather.current, temperature_2m: null } },
    { ...weather, current_units: { temperature_2m: "°F", apparent_temperature: "°F" } },
    { ...weather, current: { ...weather.current, weather_code: 999 } },
  ])("rechaza clima incompatible %j", async (response) => {
    const { get, context } = setup();
    get
      .mockReset()
      .mockResolvedValueOnce({ results: [location] })
      .mockResolvedValueOnce(response);
    await expect(getWeatherTool.handler({ city: location.name }, context)).rejects.toThrow();
  });
  it("propaga errores del proveedor", async () => {
    const { get, context } = setup();
    const error = new Error("Proveedor no disponible");
    get.mockReset().mockRejectedValue(error);
    await expect(getWeatherTool.handler({ city: location.name }, context)).rejects.toBe(error);
  });
  it("no inicia la segunda petición tras cancelar la búsqueda", async () => {
    const { get, context, controller } = setup();
    get.mockReset().mockImplementation(async () => {
      controller.abort(new Error("Cancelado"));
      return { results: [location] };
    });
    await expect(getWeatherTool.handler({ city: location.name }, context)).rejects.toThrow(
      "Cancelado",
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("no inicia peticiones si la ejecución ya fue cancelada", async () => {
    const { get, context, controller } = setup();
    controller.abort();
    await expect(getWeatherTool.handler({ city: location.name }, context)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});

it.each([{ scopes: [] as string[] }, { scopes: ["weather:read"] }])(
  "verifica el contrato MCP y el scope real %j",
  async ({ scopes }) => {
    const { context, get } = setup();
    const server = createMcpServer({
      config: context.config,
      context: { ...context, principal: { id: "fictional-client", scopes } },
      tools: [getWeatherTool],
    });
    const client = new Client({ name: "weather-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const list = await client.listTools();
      expect(list.tools[0]?.inputSchema.required).toContain("city");
      const result = await client.callTool({
        name: "get_weather",
        arguments: { city: location.name, countryCode: "gt" },
      });
      if (scopes.includes("weather:read")) {
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          result: { status: "ok", temperatureC: 21.5 },
        });
        expect(get).toHaveBeenCalledTimes(2);
      } else {
        expect(result.isError).toBe(true);
        expect(get).not.toHaveBeenCalled();
      }
    } finally {
      await client.close();
      await server.close();
    }
  },
);
