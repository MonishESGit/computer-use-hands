import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCapabilityFile, parseCapability, serializeCapability } from "../artifact/io.js";
import type { Capability } from "../artifact/schema.js";

export function catalogDir(root = process.cwd()): string {
  return path.join(root, "capabilities");
}

export function listCapabilities(root = process.cwd()): Capability[] {
  return readdirSync(catalogDir(root))
    .filter((name) => name.endsWith(".json"))
    .map((name) => loadCapabilityFile(path.join(catalogDir(root), name)));
}

export function getCapability(name: string, root = process.cwd()): Capability {
  const match = listCapabilities(root).find((cap) => cap.metadata.name === name);
  if (!match) {
    throw new Error(`capability not found: ${name}`);
  }
  return match;
}

export function approveCapability(name: string, root = process.cwd()): Capability {
  const cap = getCapability(name, root);
  cap.metadata.status = "approved";
  const file = path.join(catalogDir(root), `${name}.json`);
  writeFileSync(file, serializeCapability(parseCapability(cap)), "utf8");
  return cap;
}

export function toolDefinition(cap: Capability): unknown {
  return {
    name: cap.metadata.name,
    description: cap.metadata.description,
    parameters: Object.fromEntries(
      cap.spec.parameters.map((param) => [
        param.name,
        {
          type: param.type === "enum" ? "string" : param.type,
          description: param.description,
          enum: param.enumValues,
        },
      ]),
    ),
  };
}
