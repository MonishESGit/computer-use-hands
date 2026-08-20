import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCapabilityFile } from "../../src/artifact/io.js";

describe("committed lookup capability", () => {
  it("parses as a Hands v1 artifact sourced from the live discovery run", () => {
    const cap = loadCapabilityFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../capabilities/lookup_member_savings_balance.json"),
    );
    expect(cap.metadata.tenant.mode).toBe("canonical");
    expect(cap.metadata.sourceRunId).toMatch(/^run_/);
    expect(cap.spec.exceptionHandlers.some((h) => h.then.kind === "business_outcome")).toBe(true);
    expect(cap.spec.exceptionHandlers.some((h) => h.then.kind === "escalate")).toBe(true);
  });

  it("parses the open-product capability with an irreversible submit", () => {
    const cap = loadCapabilityFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../capabilities/open_auxiliary_share.json"),
    );
    expect(cap.spec.steps.some((step) => step.risk === "irreversible")).toBe(true);
  });
});
