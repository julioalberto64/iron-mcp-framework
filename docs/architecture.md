# Arquitectura del starter

## Objetivo

Este proyecto define una base repetible para crear MCP servers en Node.js sin que cada equipo reinvente configuracion, logs, autenticacion, REST clients, transportes y validadores.

## Capas

```txt
MCP Tool
  -> Tool contract
  -> Framework context
  -> RestClient autenticado
  -> API externa o interna
```

## Componentes

### Configuracion

`src/framework/config.ts` carga:

1. `.env`
2. `config/default.yaml`
3. overrides de variables de entorno
4. override CLI `--transport stdio|http`

Este es el unico archivo donde se permite `process.env`.

### Logging

`src/framework/logger.ts` crea un logger Pino. En `stdio`, escribe a `stderr` para no contaminar `stdout`, que el protocolo MCP usa para JSON-RPC.

### REST client

`src/framework/rest/rest-client.ts` centraliza:

- `baseUrl`
- timeout
- headers de autenticacion
- redaccion de headers sensibles en logs
- errores normalizados
- parseo JSON

Las tools no deben usar `fetch` ni `axios` directamente.

### Transportes

- `stdio`: recomendado para integraciones locales, por ejemplo clientes que lanzan el proceso.
- `http`: endpoint `/mcp` con Streamable HTTP stateless.

### Tool contract

Todas las tools deben declarar:

- `name`
- `title`
- `description`
- `inputSchema`
- `timeoutMs`
- `idempotent`
- `auth`
- `audit`
- `handler`

Esto permite revisar seguridad, auditoria, permisos, PII y estabilidad antes de publicar el MCP.
