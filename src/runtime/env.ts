import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadDotEnv(dir = process.cwd()): void {
  const file = path.join(dir, ".env");
  if (!existsSync(file)) {
    return;
  }
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function tellerSecrets(): Record<string, string> {
  return {
    teller_user: process.env.HANDS_TELLER_USER ?? "teller",
    teller_password: process.env.HANDS_TELLER_PASSWORD ?? "teller",
  };
}

export function defaultPolicyPath(): string {
  return path.join(process.cwd(), "policies", "heritage-core.yaml");
}
