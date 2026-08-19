import { z } from "zod";
import type { ActionType } from "../artifact/schema.js";

export const PolicySchema = z.object({
  allow: z.object({
    origins: z.array(z.string().min(1)).min(1),
    pathPrefixes: z.array(z.string().min(1)).min(1),
    actions: z.array(z.string().min(1)).min(1),
  }),
  deny: z.object({
    urlPatterns: z.array(z.string().min(1)),
  }),
  risk: z.object({
    irreversibleNameMatches: z.array(z.string().min(1)),
    unattendedIrreversibleRequires: z.enum(["approved", "never", "any"]),
  }),
  redact: z.object({
    secretRefs: z.array(z.string().min(1)),
    fieldNames: z.array(z.string().min(1)),
    patterns: z.array(
      z.object({
        name: z.string().min(1),
        regex: z.string().min(1),
        replace: z.string(),
      }),
    ),
  }),
});

export type Policy = z.infer<typeof PolicySchema>;

export type PolicyDecision =
  | { ok: true }
  | { ok: false; code: "policy_violation"; reason: string };

export function originAllowed(policy: Policy, url: string): PolicyDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: "policy_violation", reason: `unparseable URL: ${url}` };
  }
  const origin = parsed.origin;
  if (!policy.allow.origins.includes(origin)) {
    return { ok: false, code: "policy_violation", reason: `origin ${origin} is not allowlisted` };
  }
  if (policy.deny.urlPatterns.some((pattern) => globMatch(pattern, parsed.pathname))) {
    return { ok: false, code: "policy_violation", reason: `path ${parsed.pathname} is denied` };
  }
  const pathOk = policy.allow.pathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
  if (!pathOk && parsed.pathname !== "/") {
    return {
      ok: false,
      code: "policy_violation",
      reason: `path ${parsed.pathname} is outside allowed prefixes`,
    };
  }
  return { ok: true };
}

export function actionAllowed(policy: Policy, action: ActionType): PolicyDecision {
  if (!policy.allow.actions.includes(action)) {
    return { ok: false, code: "policy_violation", reason: `action ${action} is not allowlisted` };
  }
  return { ok: true };
}

export function isIrreversibleName(policy: Policy, name: string): boolean {
  return policy.risk.irreversibleNameMatches.some((re) => new RegExp(re, "i").test(name));
}

export function unattendedIrreversibleAllowed(
  policy: Policy,
  artifactStatus: "draft" | "approved" | "deprecated",
): PolicyDecision {
  const rule = policy.risk.unattendedIrreversibleRequires;
  if (rule === "any") {
    return { ok: true };
  }
  if (rule === "never") {
    return { ok: false, code: "policy_violation", reason: "irreversible actions are blocked" };
  }
  if (artifactStatus !== "approved") {
    return {
      ok: false,
      code: "policy_violation",
      reason: "irreversible replay requires an approved capability",
    };
  }
  return { ok: true };
}

function globMatch(pattern: string, pathname: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(pathname);
}
