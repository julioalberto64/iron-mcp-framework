# IronMCP Framework Starter

![CI](https://github.com/julioalberto64/iron-mcp-framework/actions/workflows/ci.yml/badge.svg)

Starter empresarial para crear servidores MCP en Node.js + TypeScript con:

- Transporte `stdio` para clientes locales.
- Transporte `http` con Streamable HTTP stateless.
- Configuracion por YAML + variables de entorno.
- Logs estructurados con Pino.
- REST client centralizado con autenticacion.
- Validadores de codigo y seguridad.
- Contrato obligatorio para tools: schema, auth, timeout, auditoria e idempotencia.

## Requisitos

- Node.js `>=22`
- npm `>=10`

## Inicio rapido

```bash
npm install
cp .env.example .env
npm run validate
```

Para probar HTTP:

```bash
npm run dev:http
```

En otra terminal:

```bash
bash scripts/smoke-http.sh
```

Health check HTTP normal:

```bash
curl http://127.0.0.1:3000/healthz
```

Para probar STDIO con MCP Inspector:

```bash
npm run build
npm run mcp:inspect:stdio
```

## Probar la tool REST autenticada

El proyecto trae una tool llamada `call_secure_api`. Por defecto llama a `https://httpbin.org/bearer`, que espera un header `Authorization: Bearer <token>`.

Edita `.env`:

```env
API_AUTH_TYPE=bearer-env
API_TOKEN=demo-token
API_BASE_URL=https://httpbin.org
```

Luego ejecuta:

```bash
npm run dev:http
bash scripts/smoke-http.sh examples/http/call-secure-api.json
```

## Scripts principales

```bash
npm run dev:stdio        # arranca MCP por STDIO
npm run dev:http         # arranca MCP por HTTP en /mcp
npm run build            # compila TypeScript
npm run typecheck        # valida tipos
npm run lint             # ESLint
npm run format:check     # Prettier check
npm run test             # Vitest
npm run secrets:check    # Secretlint
npm run knip             # dependencias/codigo muerto
npm run mcp:validate     # validador propio del estandar MCP
npm run validate         # quality gate completo
```

## Estructura

```txt
src/
  framework/
    auth/                 # proveedores de autenticacion
    rest/                 # REST client estandar
    transports/           # STDIO y HTTP
    config.ts             # unico lugar permitido para process.env
    create-mcp-server.ts  # registro estandarizado de tools
    errors.ts             # errores normalizados
    logger.ts             # Pino; stderr cuando transport=stdio
    types.ts              # contrato de tools
  tools/
    health.tool.ts
    call-secure-api.tool.ts
```

## Reglas del estandar

El validador propio `tools/mcp-validate.mjs` falla el build si detecta:

- `console.*` en `src/`.
- `process.env` fuera de `src/framework/config.ts`.
- `fetch(` fuera de `src/framework/rest/rest-client.ts`.
- import directo de `axios`.
- tools sin `inputSchema`, `timeoutMs`, `auth`, `audit`, `idempotent` o `handler`.
- posibles secretos hardcodeados en `config/default.yaml` o `.env.example`.

## Crear una nueva tool

Copia `src/tools/health.tool.ts` y cambia:

```ts
export const myTool = defineTool({
  name: "my_tool",
  title: "My Tool",
  description: "Descripcion clara para el modelo.",
  inputSchema: {
    id: z.string(),
  },
  timeoutMs: 5000,
  idempotent: true,
  auth: {
    required: true,
    scopes: ["my-domain:read"],
  },
  audit: {
    category: "read",
    pii: false,
  },
  async handler(input, context) {
    return context.restClient.get(`/items/${input.id}`);
  },
});
```

Luego registra la tool en `src/tools/index.ts`.

## Notas importantes sobre STDIO

Cuando `transport=stdio`, el servidor MCP usa `stdin/stdout` para JSON-RPC. Por eso este starter manda logs a `stderr` y prohibe `console.log` en `src/`.

## Siguiente paso sugerido

Cuando este starter ya funcione para tu equipo, el siguiente paso es convertir `src/framework` en paquete interno, por ejemplo `@company/mcp-framework`, y crear un CLI `create-mcp` que genere nuevos MCPs con esta misma estructura.

## Crear una nueva tool: consultar balance de datos móviles

Esta guía muestra cómo crear una tool MCP que consume este endpoint REST:

```bash
GET /api/v2.0/mobile/upselling/subscribers/{subscriberId}/balances/data?_format=json&load_roaming=false&onlinetetheringquota=false
```

La tool se llamará:

```txt
get_subscriber_data_balance
```

> Importante: nunca colocar el Bearer token directamente en el código. El token debe ir en `.env`.

---

## 1. Configurar variables de entorno

Editar el archivo `.env`:

```env
API_BASE_URL=https://www.juliomorales.dev/apirest
API_AUTH_TYPE=bearer-env
API_TOKEN=TU_TOKEN_AQUI
```

---

## 2. Crear el archivo de la tool

Crear el archivo:

```txt
src/tools/get-subscriber-data-balance.tool.ts
```

Agregar este código:

```ts
import * as z from "zod/v4";

import type { RestClient } from "../framework/rest/rest-client.js";
import { defineTool } from "../framework/types.js";

const getSubscriberDataBalanceInputSchema = z.object({
  subscriberId: z.string().min(8).describe("Número de suscriptor. Ejemplo: 50230448966"),
});

export function createGetSubscriberDataBalanceTool(restClient: RestClient) {
  return defineTool({
    name: "get_subscriber_data_balance",
    title: "Get Subscriber Data Balance",
    description:
      "Consulta el balance de datos móviles disponibles, usados y vencimiento de un suscriptor Guatemala.",
    inputSchema: {
      subscriberId: z.string().min(8).describe("Número de suscriptor. Ejemplo: 50230448966"),
    },
    outputSchema: {
      description: z.string().optional(),
      remainingValue: z.number().optional(),
      remainingFormatted: z.string().optional(),
      usedValue: z.number().optional(),
      usedFormatted: z.string().optional(),
      reservedValue: z.number().optional(),
      reservedFormatted: z.string().optional(),
      expiresAt: z.string().optional(),
      expiresIn: z.string().optional(),
      includedApps: z.array(z.string()).optional(),
      onlineTetheringFormatted: z.string().optional(),
      raw: z.unknown(),
    },
    timeoutMs: 10000,
    idempotent: true,
    auth: {
      required: true,
      scopes: ["upselling:read", "balances:read"],
    },
    audit: {
      category: "external-api",
      pii: true,
    },
    async handler(input) {
      const parsedInput = getSubscriberDataBalanceInputSchema.parse(input);

      const response = await restClient.get<{
        data?: {
          local?: {
            description?: {
              value?: string;
              formattedValue?: string;
            };
            summaryRemainingValue?: {
              value?: number;
              formattedValue?: string;
            };
            summaryReservedAmount?: {
              value?: number;
              formattedValue?: string;
            };
            summaryUsedValue?: {
              value?: number;
              formattedValue?: string;
            };
            summaryDateValue?: {
              value?: string;
              formattedValue?: string;
            };
            includedApps?: {
              tags?: {
                value?: string[];
              };
            };
            onlineTethering?: {
              label?: string;
              value?: number;
            };
          };
        };
      }>(
        `/api/v2.0/mobile/upselling/subscribers/${encodeURIComponent(
          parsedInput.subscriberId,
        )}/balances/data?_format=json&load_roaming=false&onlinetetheringquota=false`,
        {
          headers: {
            Referer: "https://www.juliomorales.dev/",
            Accept: "application/json, text/plain, */*",
          },
        },
      );

      const local = response.data?.local;

      return {
        description: local?.description?.formattedValue ?? local?.description?.value,
        remainingValue: local?.summaryRemainingValue?.value,
        remainingFormatted: local?.summaryRemainingValue?.formattedValue,
        usedValue: local?.summaryUsedValue?.value,
        usedFormatted: local?.summaryUsedValue?.formattedValue,
        reservedValue: local?.summaryReservedAmount?.value,
        reservedFormatted: local?.summaryReservedAmount?.formattedValue,
        expiresAt: local?.summaryDateValue?.value,
        expiresIn: local?.summaryDateValue?.formattedValue,
        includedApps: local?.includedApps?.tags?.value,
        onlineTetheringFormatted: local?.onlineTethering?.label,
        raw: response,
      };
    },
  });
}
```

---

## 3. Registrar la tool

Editar:

```txt
src/tools/index.ts
```

Debe quedar similar a esto:

```ts
import type { RestClient } from "../framework/rest/rest-client.js";

import { callSecureApiTool } from "./call-secure-api.tool.js";
import { createGetSubscriberBalanceTool } from "./get-subscriber-balance.tool.js";
import { createGetSubscriberDataBalanceTool } from "./get-subscriber-data-balance.tool.js";
import { healthTool } from "./health.tool.js";

export function createTools(restClient: RestClient) {
  return [
    healthTool,
    callSecureApiTool,
    createGetSubscriberBalanceTool(restClient),
    createGetSubscriberDataBalanceTool(restClient),
  ];
}
```

---

## 4. Crear ejemplo HTTP para probar

Crear el archivo:

```txt
examples/http/call-subscriber-data-balance.json
```

Con este contenido:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_subscriber_data_balance",
    "arguments": {
      "subscriberId": "50230448966"
    }
  }
}
```

---

## 5. Validar el código

Ejecutar:

```bash
npm run validate
```

Si todo está correcto, debe pasar:

```txt
mcp:validate
typecheck
lint
format:check
test
secrets:check
```

---

## 6. Levantar el servidor HTTP

```bash
npm run dev:http
```

---

## 7. Probar la tool

En otra terminal:

```bash
bash scripts/smoke-http.sh examples/http/call-subscriber-data-balance.json
```

La respuesta debe incluir información como:

```json
{
  "description": "30GB + REDES SOCIALES + MUSICA + SPORTS",
  "remainingFormatted": "15.48 GB",
  "usedFormatted": "14.52 GB",
  "reservedFormatted": "30 GB",
  "expiresIn": "11 días, 10 horas",
  "includedApps": ["WHATSAPP Incluido", "Redes Sociales", "Entretenimiento"]
}
```

---

## Reglas importantes para developers

1. No usar `fetch` directo.
2. No usar `axios` directo.
3. No colocar tokens en código.
4. Siempre usar `RestClient`.
5. Siempre validar input con Zod dentro del `handler`.
6. Toda tool debe tener:
   - `name`
   - `description`
   - `inputSchema`
   - `outputSchema`
   - `timeoutMs`
   - `auth`
   - `audit`
   - `idempotent`
7. Siempre ejecutar:

```bash
npm run validate
```

## Conventional Commits

IronMCP utiliza Conventional Commits.

Ejemplos:

```bash
git commit -m "feat: add MCP authentication middleware"
git commit -m "fix: resolve HTTP transport issue"
git commit -m "docs: update README"
git commit -m "refactor: simplify tool registration"

```

---

# ❤️ Support IronMCP

If IronMCP helps you build better MCP servers, consider supporting the project.

Your contribution helps maintain the framework, add new features, improve documentation, and keep the project open source.

## Donate via PayPal

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal)](https://www.paypal.com/paypalme/nworldt)

Or send a donation directly to:

```txt
info@nworldt.net
```

Every contribution, no matter the size, helps keep IronMCP growing.

Thank you for your support! 🚀
