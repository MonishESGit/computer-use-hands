import type { Capability } from "../artifact/schema.js";
import type { Policy } from "./enforce.js";

const REDACTED = "[REDACTED]";

export function redactText(text: string, policy: Policy): string {
  let out = text;
  for (const pattern of policy.redact.patterns) {
    out = out.replace(new RegExp(pattern.regex, "gi"), pattern.replace);
  }
  return out;
}

export function redactRecord(value: unknown, policy: Policy): unknown {
  if (typeof value === "string") {
    return redactText(value, policy);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactRecord(entry, policy));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(obj)) {
      if (policy.redact.fieldNames.some((name) => name.toLowerCase() === key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = redactRecord(entry, policy);
      }
    }
    return out;
  }
  return value;
}

/** Strip secret literals from artifacts. Secret refs stay; values never do. */
export function redactCapability(capability: Capability, policy: Policy): Capability {
  const clone = structuredClone(capability);
  for (const step of clone.spec.steps) {
    if (step.valueFrom?.kind === "literal") {
      if (policy.redact.secretRefs.includes(step.valueFrom.value)) {
        step.valueFrom = { kind: "secret", ref: "unknown" };
      } else {
        step.valueFrom.value = redactText(step.valueFrom.value, policy);
      }
    }
    if (step.notes) {
      step.notes = redactText(step.notes, policy);
    }
  }
  clone.metadata.description = redactText(clone.metadata.description, policy);
  return clone;
}

export function redactSecretValue(_ref: string, _value: string): string {
  return REDACTED;
}
