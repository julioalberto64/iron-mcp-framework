# Como agregar una nueva tool

Para trabajar con una IA, consulta [la skill de creación de tools](../.agents/skills/create-mcp-tool/SKILL.md). Su [ejemplo completo](../.agents/skills/create-mcp-tool/references/example.md) incluye validación de respuesta, registro, prueba y petición HTTP.

## 1. Crear archivo

Crea un archivo bajo `src/tools` con nombre `*.tool.ts`, por ejemplo:

```txt
src/tools/get-customer.tool.ts
```

## 2. Definir input schema

```ts
import * as z from "zod/v4";

const GetCustomerInput = z.object({
  customerId: z.string().min(1),
});
```

## 3. Definir la tool

```ts
import { defineTool } from "../framework/types.js";

export const getCustomerTool = defineTool({
  name: "get_customer",
  title: "Get Customer",
  description: "Obtiene un cliente por identificador.",
  inputSchema: {
    customerId: z.string().min(1),
  },
  timeoutMs: 8000,
  idempotent: true,
  auth: {
    required: true,
    scopes: ["customers:read"],
  },
  audit: {
    category: "read",
    pii: true,
  },
  async handler(input, context) {
    const parsed = GetCustomerInput.parse(input);
    return context.restClient.get(`/customers/${encodeURIComponent(parsed.customerId)}`);
  },
});
```

## 4. Registrar la tool

Edita `src/tools/index.ts`:

```ts
import { getCustomerTool } from "./get-customer.tool.js";

// Agrega getCustomerTool al array de createTools(), conservando las existentes.
export function createTools() {
  return [healthTool, callSecureApiTool, createGetSubscriberBalanceTool(), getCustomerTool];
}
```

## 5. Validar

```bash
npm run mcp:validate
npm run validate
```

## Cancelación

Usa `context.restClient` dentro del handler: el framework lo vincula al timeout de la tool y a la cancelación MCP. Para otras operaciones, pasa `context.signal` a la API que soporte `AbortSignal`. Comprueba `context.signal?.throwIfAborted()` antes de efectos posteriores. Evita capturar un RestClient global en la tool, ya que omitiría esta cancelación.
