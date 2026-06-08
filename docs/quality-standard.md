# Estandar de calidad

## Quality gate local

```bash
npm run validate
```

Incluye:

1. Validador MCP custom.
2. TypeScript strict.
3. ESLint.
4. Prettier check.
5. Vitest.
6. Secretlint.

## Reglas MCP obligatorias

| Regla                            | Motivo                                       |
| -------------------------------- | -------------------------------------------- |
| No `console.*` en `src/`         | No romper STDIO/JSON-RPC                     |
| No `process.env` fuera de config | Configuracion centralizada                   |
| No `fetch` fuera de RestClient   | Auth, timeout, logs y errores estandarizados |
| No `axios` directo               | Evitar clientes paralelos                    |
| Tools con `timeoutMs`            | Evitar ejecuciones infinitas                 |
| Tools con `auth`                 | Seguridad explicita                          |
| Tools con `audit.pii`            | Auditoria y clasificacion de datos           |

## CI sugerido

```yaml
name: validate-mcp

on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm install
      - run: npm run validate
      - run: npm run build
      - run: npm run audit
      - run: npm run knip
```
