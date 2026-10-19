import * as z from "zod/v4";

import { ApiError } from "../framework/errors.js";
import { defineTool } from "../framework/types.js";

const Input = z.strictObject({
  city: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[\p{L}\p{M}][\p{L}\p{M} .’'()-]*$/u)
    .describe("Nombre de la ciudad, sin país ni región"),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/u)
    .transform((value) => value.toUpperCase())
    .optional()
    .describe("Código ISO del país para precisar la búsqueda"),
  locationId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Identificador de uno de los candidatos devueltos para esta ciudad"),
});
const Location = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  country: z.string().min(1).max(200),
  country_code: z.string().regex(/^[A-Z]{2}$/u),
  admin1: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const SearchResponse = z.object({ results: z.array(Location).max(100).optional() });
const descriptions: Readonly<Record<number, string>> = {
  0: "Cielo despejado",
  1: "Mayormente despejado",
  2: "Parcialmente nublado",
  3: "Nublado",
  45: "Niebla",
  48: "Niebla con escarcha",
  51: "Llovizna ligera",
  53: "Llovizna moderada",
  55: "Llovizna intensa",
  56: "Llovizna helada ligera",
  57: "Llovizna helada intensa",
  61: "Lluvia ligera",
  63: "Lluvia moderada",
  65: "Lluvia intensa",
  66: "Lluvia helada ligera",
  67: "Lluvia helada intensa",
  71: "Nevada ligera",
  73: "Nevada moderada",
  75: "Nevada intensa",
  77: "Granos de nieve",
  80: "Chubascos ligeros",
  81: "Chubascos moderados",
  82: "Chubascos intensos",
  85: "Chubascos de nieve ligeros",
  86: "Chubascos de nieve intensos",
  95: "Tormenta",
  96: "Tormenta con granizo ligero",
  99: "Tormenta con granizo intenso",
};
const WeatherResponse = z.object({
  current_units: z.object({
    temperature_2m: z.literal("°C"),
    apparent_temperature: z.literal("°C"),
  }),
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    weather_code: z
      .number()
      .int()
      .refine((code) => descriptions[code] !== undefined, "Código meteorológico no reconocido"),
  }),
});
const Candidate = z.object({
  locationId: z.number().int().positive(),
  city: z.string(),
  country: z.string(),
  countryCode: z.string(),
  region: z.string().optional(),
});
const Output = z.object({
  result: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      city: z.string(),
      country: z.string(),
      temperatureC: z.number(),
      feelsLikeC: z.number(),
      description: z.string(),
    }),
    z.object({
      status: z.literal("needs_clarification"),
      message: z.string(),
      candidates: z.array(Candidate),
      truncated: z.boolean(),
    }),
  ]),
  attribution: z.literal("Weather data by Open-Meteo (https://open-meteo.com/), CC BY 4.0"),
});
const attribution = "Weather data by Open-Meteo (https://open-meteo.com/), CC BY 4.0" as const;
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const getWeatherTool = defineTool({
  name: "get_weather",
  title: "Consultar clima actual",
  description:
    "Consulta condiciones actuales modeladas por Open-Meteo en °C. Si la ciudad es ambigua, solicita país o locationId antes de consultar el clima. Uso no comercial.",
  inputSchema: Input.shape,
  outputSchema: Output.shape,
  timeoutMs: 15000,
  idempotent: true,
  auth: { required: true, scopes: ["weather:read"] },
  audit: { category: "external-api", pii: false },
  async handler(input, context) {
    const parsed = Input.parse(input);
    context.signal?.throwIfAborted();
    const query = new URLSearchParams({
      name: parsed.city,
      count: "100",
      language: "es",
      format: "json",
    });
    if (parsed.countryCode !== undefined) query.set("countryCode", parsed.countryCode);
    const search = SearchResponse.parse(
      await context.restClient.get<unknown>(`/v1/search?${query.toString()}`, {
        service: "weather-geocoding",
      }),
    );
    context.signal?.throwIfAborted();
    const results = search.results ?? [];
    const matches = results.filter(
      (location) =>
        normalize(location.name) === normalize(parsed.city) &&
        (parsed.countryCode === undefined || location.country_code === parsed.countryCode) &&
        (parsed.locationId === undefined || location.id === parsed.locationId),
    );
    const unique = [...new Map(matches.map((location) => [location.id, location])).values()];
    const location = unique[0];
    if (location === undefined) {
      throw new ApiError(
        "No se encontró la ciudad con esos filtros. Revisa city, countryCode o locationId.",
        404,
      );
    }
    const truncated = results.length === 100;
    if (unique.length > 1 || (truncated && parsed.locationId === undefined)) {
      return Output.parse({
        result: {
          status: "needs_clarification",
          message:
            "Precisa el país con countryCode o elige un locationId de los candidatos y repite la consulta con city. La lista puede ser parcial.",
          candidates: unique.map((item) => ({
            locationId: item.id,
            city: item.name,
            country: item.country,
            countryCode: item.country_code,
            ...(item.admin1 === undefined ? {} : { region: item.admin1 }),
          })),
          truncated,
        },
        attribution,
      });
    }
    const weatherQuery = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: "temperature_2m,apparent_temperature,weather_code",
      temperature_unit: "celsius",
    });
    const weather = WeatherResponse.parse(
      await context.restClient.get<unknown>(`/v1/forecast?${weatherQuery.toString()}`, {
        service: "weather-current",
      }),
    );
    context.signal?.throwIfAborted();
    return Output.parse({
      result: {
        status: "ok",
        city: location.name,
        country: location.country,
        temperatureC: weather.current.temperature_2m,
        feelsLikeC: weather.current.apparent_temperature,
        description: descriptions[weather.current.weather_code],
      },
      attribution,
    });
  },
});
