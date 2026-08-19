import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCapability } from "../../src/artifact/io.js";
import {
  actionAllowed,
  isIrreversibleName,
  originAllowed,
  unattendedIrreversibleAllowed,
} from "../../src/policy/enforce.js";
import { loadPolicyFile } from "../../src/policy/load.js";
import { redactCapability, redactRecord, redactText } from "../../src/policy/redact.js";

const policyPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../policies/heritage-core.yaml",
);

describe("Heritage Core policy", () => {
  const policy = loadPolicyFile(policyPath);

  it("allows tenant paths on loopback and blocks anything else", () => {
    expect(originAllowed(policy, "http://127.0.0.1:3401/t/first-federal/login").ok).toBe(true);
    expect(originAllowed(policy, "https://evil.example/t/first-federal/login").ok).toBe(false);
    expect(originAllowed(policy, "http://127.0.0.1:3401/admin/purge").ok).toBe(false);
    expect(originAllowed(policy, "http://127.0.0.1:3401/t/other/login").ok).toBe(false);
  });

  it("treats confirm/post labels as irreversible and gates unattended replay", () => {
    expect(isIrreversibleName(policy, "Confirm Opening")).toBe(true);
    expect(isIrreversibleName(policy, "Sign On")).toBe(false);
    expect(unattendedIrreversibleAllowed(policy, "draft").ok).toBe(false);
    expect(unattendedIrreversibleAllowed(policy, "approved").ok).toBe(true);
    expect(actionAllowed(policy, "click").ok).toBe(true);
    expect(actionAllowed(policy, "navigate").ok).toBe(true);
  });

  it("redacts passwords in logs and never leaves secret literals on an artifact", () => {
    expect(redactText("pwd=teller session", policy)).toContain("[REDACTED]");
    const rec = redactRecord({ password: "teller", memberId: "12345" }, policy) as {
      password: string;
      memberId: string;
    };
    expect(rec.password).toBe("[REDACTED]");
    expect(rec.memberId).toBe("12345");

    const cap = parseCapability({
      apiVersion: "hands/v1",
      kind: "Capability",
      metadata: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "lookup_member_savings_balance",
        title: "Look up",
        description: "password=teller should not persist",
        version: "1.0.0",
        createdAt: "2026-08-19T18:00:00.000Z",
        sourceRunId: "run_fixture",
        status: "draft",
        vendorApp: { id: "heritage-core", version: "1.0.0" },
        tenant: { mode: "canonical" },
        surfaceKind: "web",
        tags: ["test"],
      },
      spec: {
        entry: { urlTemplate: "http://127.0.0.1:3401/t/{{tenant}}/login", surface: "web" },
        parameters: [
          {
            name: "tenant",
            type: "enum",
            required: true,
            description: "tenant",
            pii: "none",
            enumValues: ["first-federal", "riverside"],
          },
        ],
        outputs: [],
        success: { type: "checkpoint", checkpointId: "done" },
        steps: [
          {
            id: "s1",
            action: "navigate",
            risk: "safe",
            checkpoint: { id: "done", kind: "url_includes", value: "/login" },
          },
        ],
        exceptionHandlers: [],
      },
    });
    const redacted = redactCapability(cap, policy);
    expect(redacted.metadata.description).not.toMatch(/teller/);
    expect(redacted.metadata.description).toContain("[REDACTED]");
  });
});
