# Ejemplo de consulta REST y sus pruebas

Este ejemplo supone un contrato ficticio: `GET /customers/{id}` responde `{ "id": "demo-1", "name": "Cliente demo" }`. Úsalo como patrón, no como especificación de una API real. Sustituye los schemas, ruta y permisos por los del pedido.

## Tool: `src/tools/get-customer.tool.ts`

```ts
import * as z from "zod/v4";

import { defineTool } from "../framework/types.js";

const GetCustomerInput = z.object({
  customerId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/u),
});
const CustomerResponse = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
});
const GetCustomerOutput = z.object({
  customerId: z.string(),
  name: z.string(),
});

export const getCustomerTool = defineTool({
  name: "get_customer",
  title: "Consultar cliente",
  description: "Consulta el identificador y nombre de un cliente autorizado.",
  inputSchema: GetCustomerInput.shape,
  outputSchema: GetCustomerOutput.shape,
  timeoutMs: 8000,
  idempotent: true,
  auth: {
    required: true,
    scopes: ["customers:read"],
  },
  audit: {
    category: "external-api",
    pii: true,
  },
  async handler(input, context) {
    const parsed = GetCustomerInput.parse(input);
    const response = await context.restClient.get<unknown>(
      `/customers/${encodeURIComponent(parsed.customerId)}`,
    );
    const customer = CustomerResponse.parse(response);
    return GetCustomerOutput.parse({
      customerId: customer.id,
      name: customer.name,
    });
  },
});
```

Importa `getCustomerTool` en `src/tools/index.ts` y agrégala al array devuelto por `createTools()`. Conserva las demás tools.

## Prueba: `test/tools/get-customer.tool.test.ts`

Esta prueba usa un doble únicamente en la frontera REST. La validación de inputs y de la respuesta se ejecuta realmente. La autorización y la vinculación del cliente a la cancelación se prueban en los tests del framework.

```ts
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { parseConfig } from "../../src/framework/config.js";
import type { RestClient } from "../../src/framework/rest/rest-client.js";
import { getCustomerTool } from "../../src/tools/get-customer.tool.js";

function setup() {
  const get = vi.fn().mockResolvedValue({ id: "demo-1", name: "Cliente demo" });
  const config = parseConfig({
    server: { name: "test", version: "1.0.0" },
    transport: "stdio",
    http: { host: "127.0.0.1", port: 3000, path: "/mcp" },
    logging: { level: "fatal" },
    api: { baseUrl: "https://api.example.test", timeoutMs: 1000 },
    auth: { type: "none" },
    mcpAuth: { enabled: false },
  });
  const context = {
    config,
    logger: pino({ level: "silent" }),
    restClient: { get } as unknown as RestClient,
    principal: { id: "test-client", scopes: ["customers:read"] },
    signal: new AbortController().signal,
  };
  return { get, context };
}

describe("getCustomerTool", () => {
  it("consulta la ruta esperada y devuelve solo los campos declarados", async () => {
    const { get, context } = setup();
    get.mockResolvedValue({
      id: "demo-1",
      name: "Cliente demo",
      internalNotes: "No exponer",
    });
    await expect(getCustomerTool.handler({ customerId: "demo-1" }, context)).resolves.toEqual({
      customerId: "demo-1",
      name: "Cliente demo",
    });
    expect(get).toHaveBeenCalledExactlyOnceWith("/customers/demo-1");
  });

  it.each(["", "../admin", "https://otro.example", "x".repeat(65)])(
    "rechaza el identificador inválido %j antes de llamar REST",
    async (customerId) => {
      const { get, context } = setup();
      await expect(getCustomerTool.handler({ customerId }, context)).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("rechaza una respuesta incompatible con el contrato", async () => {
    const { get, context } = setup();
    get.mockResolvedValue({ id: "demo-1", name: 42 });
    await expect(getCustomerTool.handler({ customerId: "demo-1" }, context)).rejects.toThrow();
  });

  it("propaga el error del proveedor sin fabricar un resultado exitoso", async () => {
    const { get, context } = setup();
    const error = new Error("Proveedor no disponible");
    get.mockRejectedValue(error);
    await expect(getCustomerTool.handler({ customerId: "demo-1" }, context)).rejects.toBe(error);
  });
});
```

## Petición: `examples/http/call-get-customer.json`

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_customer",
    "arguments": {
      "customerId": "demo-1"
    }
  }
}
```

La petición usa `POST /mcp` con `Content-Type: application/json`, `Accept: application/json, text/event-stream` y el Bearer token MCP configurado por el usuario. El principal debe tener `customers:read` en `MCP_AUTH_SCOPES`, además de los scopes que necesite para las otras tools. El ejemplo no requiere que se conceda ese permiso a los clientes existentes automáticamente.
