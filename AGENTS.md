# Instrucciones para agentes en IronMCP

Este repositorio es un framework Node.js y TypeScript para crear tools MCP. Reutiliza su registro, cliente REST, autenticación, cancelación y transportes existentes.

## Skills del repositorio

- **create-mcp-tool**: crea o amplía una tool a partir de una operación o endpoint, con schemas, permisos, registro, pruebas y ejemplos. Instrucciones: [.agents/skills/create-mcp-tool/SKILL.md](.agents/skills/create-mcp-tool/SKILL.md).

Cuando el usuario solicite crear, agregar o ampliar una tool MCP en este proyecto, lee esa skill antes de implementar. No hace falta que el usuario mencione su nombre. Si pide el cambio, realiza la implementación y las verificaciones; no te limites a proponer código. Una pregunta explicativa sobre tools no requiere modificar el repositorio.

Los agentes que no descubran skills automáticamente pueden abrir el mismo `SKILL.md` y seguirlo como guía local. No cargues esta skill para tareas ajenas a las tools.

## Contrato y verificaciones

- El contrato vigente está en `src/framework/types.ts`; el registro está en `src/tools/index.ts` mediante `createTools()`.
- Las tools usan `context.restClient` y, para otras APIs asíncronas, `context.signal`. No captures un cliente compartido que eluda la cancelación de cada ejecución.
- Usa `context.logger`; `stdout` está reservado a JSON-RPC en STDIO. Las variables de entorno se leen únicamente en `src/framework/config.ts`.
- No copies credenciales ni datos reales de `.env` o del entorno local de Postman a código, pruebas o ejemplos. Agregar una tool no implica ampliar los permisos de los clientes existentes.
- Después de cambios de código ejecuta `npm run validate`, `npm run build` y `npm run knip`. Informa cualquier comprobación que no se haya podido ejecutar.

Los commits usan Conventional Commits, por ejemplo `feat: add customer lookup tool`, sin punto final.
