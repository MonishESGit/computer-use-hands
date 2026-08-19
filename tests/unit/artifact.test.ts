import { describe, expect, it } from "vitest";
import { canonicalizeLocatorName, namePatternFor } from "../../src/artifact/canonicalize.js";
import { parseCapability } from "../../src/artifact/io.js";
import { ParameterError, interpolate, resolveParameters } from "../../src/artifact/parameters.js";
import type { Capability } from "../../src/artifact/schema.js";

function validCapability(overrides: Record<string, unknown> = {}): unknown {
  const base = {
    apiVersion: "hands/v1",
    kind: "Capability",
    metadata: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "lookup_member_savings_balance",
      title: "Look up member savings balance",
      description: "Sign on and read the savings balance for a member identifier.",
      version: "1.0.0",
      createdAt: "2026-08-19T18:00:00.000Z",
      sourceRunId: "run_fixture",
      status: "approved",
      vendorApp: { id: "heritage-core", version: "1.0.0" },
      tenant: { mode: "canonical" },
      surfaceKind: "web",
      tags: ["heritage-core", "inquiry"],
    },
    spec: {
      entry: {
        urlTemplate: "http://127.0.0.1:{{port}}/t/{{tenant}}/login",
        surface: "web",
      },
      parameters: [
        {
          name: "tenant",
          type: "enum",
          required: true,
          description: "Institution path prefix",
          pii: "none",
          enumValues: ["first-federal", "riverside"],
        },
        {
          name: "memberId",
          type: "string",
          required: true,
          description: "Five-digit member/customer number",
          pii: "identifier",
          example: "12345",
        },
        {
          name: "port",
          type: "number",
          required: false,
          description: "Heritage Core port",
          pii: "none",
          default: 3401,
        },
      ],
      outputs: [
        {
          name: "memberName",
          type: "string",
          description: "Name on the CIF record",
          pii: "identifier",
          extractor: {
            parse: "text",
            from: {
              description: "Member name cell",
              locators: [
                {
                  strategy: "visible_text",
                  namePattern: "Alicia Nguyen|Marcus Hale|Priya Shah",
                  confidence: 0.4,
                },
              ],
            },
          },
        },
      ],
      success: { type: "checkpoint", checkpointId: "on_member_detail" },
      steps: [
        {
          id: "s1",
          action: "navigate",
          risk: "safe",
          valueFrom: { kind: "literal", value: "http://127.0.0.1:{{port}}/t/{{tenant}}/login" },
        },
        {
          id: "s2",
          action: "fill",
          risk: "safe",
          target: {
            description: "User ID",
            locators: [
              {
                strategy: "ax_role_name",
                role: "textbox",
                name: "User ID",
                confidence: 0.95,
              },
            ],
          },
          valueFrom: { kind: "secret", ref: "teller_user" },
        },
        {
          id: "s3",
          action: "click",
          risk: "safe",
          target: {
            description: "Sign On",
            locators: [
              {
                strategy: "ax_role_name",
                role: "button",
                name: "Sign On",
                confidence: 0.95,
              },
            ],
          },
          checkpoint: {
            id: "on_member_detail",
            kind: "text_includes",
            value: "CIF record",
          },
        },
      ],
      exceptionHandlers: [
        {
          id: "h_not_found",
          when: { match: "not_found" },
          then: {
            kind: "business_outcome",
            code: "MEMBER_NOT_FOUND",
            message: "No CIF record for this identifier",
          },
        },
      ],
    },
  };
  return deepMerge(base, overrides);
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (Array.isArray(b) || Array.isArray(a) || typeof b !== "object" || b === null || typeof a !== "object" || a === null) {
    return b === undefined ? a : b;
  }
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

describe("Capability schema", () => {
  it("accepts a well-formed v1 artifact", () => {
    const cap = parseCapability(validCapability());
    expect(cap.metadata.name).toBe("lookup_member_savings_balance");
    expect(cap.spec.exceptionHandlers[0]?.then.kind).toBe("business_outcome");
  });

  it("rejects a wrong apiVersion", () => {
    expect(() => parseCapability(validCapability({ apiVersion: "hands/v0" }))).toThrow(/apiVersion/);
  });

  it("rejects a fill step with no valueFrom", () => {
    const draft = validCapability() as Capability;
    const steps = draft.spec.steps.map((step, i) => {
      if (i !== 1) {
        return step;
      }
      const { valueFrom: _omit, ...rest } = step;
      return rest;
    });
    expect(() =>
      parseCapability({
        ...draft,
        spec: { ...draft.spec, steps },
      }),
    ).toThrow(/valueFrom/);
  });

  it("rejects a success checkpoint that no step defines", () => {
    const draft = validCapability() as { spec: { success: { checkpointId: string } } };
    draft.spec.success.checkpointId = "missing";
    expect(() => parseCapability(draft)).toThrow(/checkpointId/);
  });
});

describe("canonical tenant names", () => {
  it("builds a namePattern that matches both institution labels", () => {
    const pattern = namePatternFor("Member Number");
    expect(pattern).toBe("Member Number|Customer No\\.");
    const loc = canonicalizeLocatorName({
      strategy: "ax_role_name" as const,
      role: "textbox",
      name: "Member Number",
      confidence: 0.9,
    });
    expect(loc.namePattern).toBe("Member Number|Customer No\\.");
  });
});

describe("parameter binding", () => {
  it("interpolates entry URLs from typed params", () => {
    const cap = parseCapability(validCapability());
    const params = resolveParameters(cap, { tenant: "riverside", memberId: "12345" });
    expect(interpolate(cap.spec.entry.urlTemplate, params)).toBe(
      "http://127.0.0.1:3401/t/riverside/login",
    );
  });

  it("rejects an unknown tenant enum value", () => {
    const cap = parseCapability(validCapability());
    expect(() => resolveParameters(cap, { tenant: "other", memberId: "12345" })).toThrow(
      ParameterError,
    );
  });
});
