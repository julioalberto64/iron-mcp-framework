import * as z from "zod/v4";

import { defineTool } from "../framework/types.js";

const SecureApiInput = z.object({
  path: z.enum(["/bearer"]).default("/bearer").describe("Endpoint de demostracion permitido"),
});

export const callSecureApiTool = defineTool({
  name: "call_secure_api",
  title: "Call Secure API",
  description:
    "Ejemplo de tool que llama una API REST por debajo usando el RestClient autenticado del framework.",
  inputSchema: {
    path: z.enum(["/bearer"]).default("/bearer").describe("Endpoint de demostracion permitido"),
  },
  outputSchema: {
    baseUrl: z.string(),
    path: z.string(),
    response: z.unknown(),
  },
  timeoutMs: 10000,
  idempotent: true,
  auth: {
    required: true,
    scopes: ["external-api:read"],
  },
  audit: {
    category: "external-api",
    pii: false,
  },
  async handler(input, context) {
    const parsed = SecureApiInput.parse(input);
    const response = await context.restClient.get<unknown>(parsed.path);

    return {
      baseUrl: context.config.api.baseUrl,
      path: parsed.path,
      response,
    };
  },
});
