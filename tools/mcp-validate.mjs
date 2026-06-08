#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootArg = process.argv[2] ?? "src";
const root = path.resolve(process.cwd(), rootArg);
const repoRoot = process.cwd();
const failures = [];

if (!fs.existsSync(root)) {
  fail(`No existe el directorio objetivo: ${rootArg}`);
} else {
  validateSourceRules(root);
  validateToolContracts(root);
  validateConfigSecrets(repoRoot);
}

if (failures.length > 0) {
  console.error("\nMCP validation failed:\n");
  for (const item of failures) {
    console.error(`- ${item}`);
  }
  console.error("");
  process.exit(1);
}

console.log("MCP validation passed.");

function validateSourceRules(sourceRoot) {
  const files = listFiles(sourceRoot).filter((file) => file.endsWith(".ts"));

  for (const file of files) {
    const relative = normalize(path.relative(repoRoot, file));
    const content = fs.readFileSync(file, "utf8");

    if (content.includes("console.")) {
      fail(
        `${relative}: no uses console.*; usa logger del framework. En STDIO stdout debe quedar libre para JSON-RPC.`,
      );
    }

    if (content.includes("process.env") && relative !== "src/framework/config.ts") {
      fail(`${relative}: process.env solo puede usarse en src/framework/config.ts.`);
    }

    if (content.includes('from "axios"') || content.includes("from 'axios'")) {
      fail(`${relative}: no importes axios directamente; usa RestClient.`);
    }

    if (content.includes("fetch(") && relative !== "src/framework/rest/rest-client.ts") {
      fail(`${relative}: fetch directo prohibido fuera de RestClient.`);
    }
  }
}

function validateToolContracts(sourceRoot) {
  const toolFiles = listFiles(sourceRoot).filter((file) => file.endsWith(".tool.ts"));

  if (toolFiles.length === 0) {
    fail("No se encontraron tools con patron *.tool.ts.");
    return;
  }

  for (const file of toolFiles) {
    const relative = normalize(path.relative(repoRoot, file));
    const content = fs.readFileSync(file, "utf8");

    requireContent(relative, content, "defineTool(", "la tool debe usar defineTool(...)");
    requireContent(relative, content, "name:", "la tool debe declarar name");
    requireContent(relative, content, "title:", "la tool debe declarar title");
    requireContent(relative, content, "description:", "la tool debe declarar description");
    requireContent(relative, content, "inputSchema:", "la tool debe declarar inputSchema");
    requireContent(relative, content, "timeoutMs:", "la tool debe declarar timeoutMs");
    requireContent(relative, content, "idempotent:", "la tool debe declarar idempotent");
    requireContent(relative, content, "auth:", "la tool debe declarar auth");
    requireContent(relative, content, "audit:", "la tool debe declarar audit");
    requireContent(relative, content, "pii:", "la tool debe declarar audit.pii");
    requireContent(relative, content, "handler(", "la tool debe declarar handler");

    const timeout = content.match(/timeoutMs\s*:\s*(\d+)/u);
    if (timeout === null) {
      fail(`${relative}: timeoutMs debe ser un numero literal para facilitar revision.`);
      continue;
    }

    const timeoutMs = Number.parseInt(timeout[1], 10);
    if (timeoutMs <= 0 || timeoutMs > 30000) {
      fail(`${relative}: timeoutMs debe estar entre 1 y 30000 ms.`);
    }
  }
}

function validateConfigSecrets(repoRootPath) {
  const candidates = ["config/default.yaml", ".env.example"];

  for (const candidate of candidates) {
    const file = path.join(repoRootPath, candidate);
    if (!fs.existsSync(file)) {
      continue;
    }

    const content = fs.readFileSync(file, "utf8");
    const suspiciousPatterns = [
      /API_TOKEN[ \t]*=[ \t]*[^\s#]+/u,
      /API_KEY[ \t]*=[ \t]*[^\s#]+/u,
      /token:[ \t]*["']?[A-Za-z0-9_\-.]{12,}/u,
      /apiKey:[ \t]*["']?[A-Za-z0-9_\-.]{12,}/u,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(content)) {
        fail(`${candidate}: posible secreto hardcodeado. Usa variables de entorno o vault.`);
      }
    }
  }
}

function requireContent(relative, content, needle, message) {
  if (!content.includes(needle)) {
    fail(`${relative}: ${message}`);
  }
}

function listFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") {
        continue;
      }
      files.push(...listFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function fail(message) {
  failures.push(message);
}

function normalize(value) {
  return value.split(path.sep).join("/");
}
