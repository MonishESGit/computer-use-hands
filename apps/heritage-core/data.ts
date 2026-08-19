import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MemberRecord, TenantConfig, TenantId } from "./types.js";

const root = path.dirname(fileURLToPath(import.meta.url));

const TENANT_IDS: readonly TenantId[] = ["first-federal", "riverside"];

export function isTenantId(value: string): value is TenantId {
  return (TENANT_IDS as readonly string[]).includes(value);
}

export function loadTenant(id: TenantId): TenantConfig {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(root, "tenants", `${id}.json`), "utf8"),
  ) as TenantConfig;
  return parsed;
}

export function loadMembers(): MemberRecord[] {
  return JSON.parse(
    fs.readFileSync(path.join(root, "data", "members.json"), "utf8"),
  ) as MemberRecord[];
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
