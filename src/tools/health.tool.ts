import * as z from "zod/v4";

import { defineTool } from "../framework/types.js";

export const healthTool = defineTool({
  name: "health_check",
  title: "Health Check",
  description: "Valida que el servidor MCP este levantado y devuelve informacion basica.",
  inputSchema: {
    echo: z.string().optional().describe("Texto opcional para probar el paso de parametros"),
  },
  outputSchema: {
    ok: z.boolean(),
    server: z.string(),
    version: z.string(),
    transport: z.string(),
    echo: z.string().optional(),
  },
  timeoutMs: 3000,
  idempotent: true,
  auth: {
    required: false,
  },
  audit: {
    category: "system",
    pii: false,
  },
  handler(input, context) {
    return Promise.resolve({
      ok: true,
      server: context.config.server.name,
      version: context.config.server.version,
      transport: context.config.transport,
      echo: input.echo,
    });
  },
});
