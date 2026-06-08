# Como agregar una nueva tool

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
    return context.restClient.get(`/customers/${parsed.customerId}`);
  },
});
```

## 4. Registrar la tool

Edita `src/tools/index.ts`:

```ts
import { getCustomerTool } from "./get-customer.tool.js";

export const tools = [healthTool, callSecureApiTool, getCustomerTool];
```

## 5. Validar

```bash
npm run mcp:validate
npm run validate
```
