---
name: create-mcp-tool
description: Crea o amplía tools MCP en IronMCP a partir de una operación local o un endpoint REST; implementa schemas, permisos, cancelación, registro, pruebas y ejemplos. Úsala cuando se pida agregar una tool a este repositorio, no para construir otro servidor MCP o modificar únicamente su transporte.
---

# Crear una tool en IronMCP

Implementa la tool solicitada y deja el cambio validado. Las rutas `src/`, `test/`, `examples/` y `docs/` de esta guía son relativas a la raíz del repositorio. Da prioridad al código vigente si esta guía y el contrato difieren.

## Ubicar el contrato

Lee `src/framework/types.ts`, `src/framework/create-mcp-server.ts`, `src/tools/index.ts` y una tool similar antes de editar. Para una integración REST, consulta también `src/framework/rest/rest-client.ts`. Usa [references/example.md](references/example.md) cuando necesites un ejemplo completo de tool, prueba y petición HTTP; adapta sus campos al endpoint real.

A partir del pedido y la documentación disponible, identifica nombre, propósito, entradas, operación, respuesta esperada y permisos. Si falta un dato que impida definir la integración, pide ese dato; no inventes endpoints ni campos del proveedor. Si la información alcanza, implementa sin detenerte en una propuesta.

## Implementar e integrar

- Crea `src/tools/<nombre-kebab-case>.tool.ts` con un nombre MCP único en `snake_case` y `defineTool` de `../framework/types.js`. Usa imports `.js` para módulos locales e `import * as z from "zod/v4"`.
- Define `name`, `title`, `description`, `inputSchema`, `outputSchema`, `timeoutMs`, `idempotent`, `auth`, `audit` y `handler`. `outputSchema` es opcional en TypeScript, pero es la convención para nuevas tools con salida estructurada. Los schemas de registro son **shapes**, no `z.object(...)`; puedes compartir `.shape` con los objetos usados para validar.
- Declara `timeoutMs` como un literal entre 1 y 30000; el validador actual inspecciona texto. Describe con precisión si la operación consulta o cambia estado y define `idempotent` según su comportamiento real, no solo por el verbo HTTP.
- Valida dentro de `handler(input, context)` con Zod antes de acceder a la API. Restringe formato y longitud según el dominio; codifica cada segmento dinámico con `encodeURIComponent` y construye las queries con `URLSearchParams`.
- Para REST usa `context.restClient.get` o `.post`. Este cliente está asociado al `AbortSignal` de la ejecución. No captures un cliente global ni crees otro cliente dentro de la tool. Si necesitas otro método HTTP que el cliente todavía no ofrece, extiéndelo con el cambio mínimo y sus pruebas; no simules el método ni eludas el cliente.
- Fija la ruta según el propósito de la tool. No aceptes URLs completas ni rutas arbitrarias del usuario. El cliente admite únicamente rutas del origen configurado, bloquea redirecciones y limita las respuestas a 2 MiB.
- Valida las respuestas externas relevantes: los genéricos TypeScript no validan JSON. Devuelve un objeto acorde a `outputSchema`, con los campos necesarios para el usuario. No incluyas `raw`, headers, tokens o datos personales ajenos al propósito por copiar otras tools.
- El framework transforma el objeto devuelto en un resultado MCP; no construyas manualmente `content` ni `isError` dentro del handler. Propaga los fallos; usa los errores existentes de `src/framework/errors.ts` cuando aporten contexto seguro.
- Registra la tool en el array devuelto por `createTools()` en `src/tools/index.ts`, conservando las existentes. Una factory, si resulta útil, no debe capturar el RestClient: el handler lo obtiene del contexto.

## Permisos y cancelación

Para datos protegidos o cambios de estado, declara `auth: { required: true, scopes: [...] }` con permisos del dominio. El framework comprueba la identidad y exige **todos** los scopes declarados. Usa `required: false` solo para operaciones que deban ser públicas.

`audit.category` permite `read`, `write`, `delete`, `external-api` y `system`; marca `pii` de acuerdo con los datos de la operación. No escribas parámetros sensibles en logs. Usa `context.logger`, nunca `console.*` en `src/`.

`MCP_AUTH_TOKEN` autentica al cliente MCP; `API_TOKEN` o `API_KEY` autentican la API externa. No los confundas ni los leas desde la tool: `process.env` está centralizado en `src/framework/config.ts`. Documenta el scope requerido y cómo configurarlo en `MCP_AUTH_SCOPES`; no amplíes automáticamente los permisos de `.env` ni rotes credenciales al agregar una tool.

Para operaciones asíncronas ajenas a RestClient, pasa `context.signal` a las APIs que acepten `AbortSignal`. Comprueba `context.signal?.throwIfAborted()` antes de efectos posteriores. Evita trabajo en segundo plano y reintentos automáticos en escrituras; el timeout no revierte cambios ya aplicados por la API externa ni interrumpe código que ignora la señal.

## Pruebas y entrega

Añade pruebas de comportamiento en `test/tools/<nombre>.tool.test.ts`. Comprueba la petición y el resultado esperados, y que entradas inválidas no produzcan llamadas externas. Para integraciones REST comprueba también una respuesta incompatible o un error del proveedor; cubre la cancelación cuando introduzcas operaciones propias. Usa respuestas ficticias o servidores locales, nunca suscriptores ni servicios reales. Las pruebas directas del handler no demuestran que el middleware aplique autorización: si cambias el framework de permisos, amplía sus pruebas de integración.

Añade un ejemplo `tools/call` en `examples/http/call-<nombre>.json`. Si corresponde a las pruebas del usuario, agrega la petición a la colección en `examples/postman/` reutilizando `{{mcp_url}}` y `{{mcp_token}}`. No añadas credenciales a los ejemplos ni leas `.env` o `.postman.local_environment.json` para escribirlos.

Desde la raíz, formatea solo los archivos modificados con Prettier y ejecuta:

```bash
npm run validate
npm run build
npm run knip
```

`validate` incluye el validador MCP, tipos, lint, formato, Vitest y Secretlint. No debilites reglas ni excluyas archivos para ocultar errores. Informa las comprobaciones que no puedan ejecutarse y su causa; no las presentes como aprobadas. No arranques un servidor persistente ni consultes APIs reales si el pedido solo era crear la tool.

Al terminar, indica nombre MCP, archivos relevantes, inputs, scopes requeridos y resultado de las pruebas. Para probar manualmente: MCP usa `POST /mcp`, `GET /healthz` es solo estado HTTP, el transporte no requiere sesión y los resultados pueden llegar como eventos SSE. No cambies el transporte por agregar una tool.
