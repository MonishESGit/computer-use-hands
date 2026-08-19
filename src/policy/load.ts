import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { PolicySchema, type Policy } from "./enforce.js";

export function loadPolicyFile(filePath: string): Policy {
  const raw = parse(readFileSync(filePath, "utf8")) as unknown;
  return PolicySchema.parse(raw);
}
