import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CapabilitySchema, type Capability } from "./schema.js";

export function parseCapability(input: unknown): Capability {
  return CapabilitySchema.parse(input);
}

export function parseCapabilityJson(text: string): Capability {
  return parseCapability(JSON.parse(text) as unknown);
}

export function loadCapabilityFile(filePath: string): Capability {
  return parseCapabilityJson(readFileSync(filePath, "utf8"));
}

export function serializeCapability(capability: Capability): string {
  return `${JSON.stringify(capability, null, 2)}\n`;
}

export function writeCapabilityFile(filePath: string, capability: Capability): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeCapability(parseCapability(capability)), "utf8");
}
