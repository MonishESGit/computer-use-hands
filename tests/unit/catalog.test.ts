import { describe, expect, it } from "vitest";
import { emitPlaywrightSpec } from "../../src/codegen/playwrightSpec.js";
import { listCapabilities, toolDefinition } from "../../src/catalog/store.js";

describe("capability catalog", () => {
  it("lists the committed lookup capability as a callable tool", () => {
    const caps = listCapabilities();
    const lookup = caps.find((cap) => cap.metadata.name === "lookup_member_savings_balance");
    expect(lookup).toBeTruthy();
    const tool = toolDefinition(lookup!);
    expect(JSON.stringify(tool)).toContain("memberId");
  });
});

describe("codegen", () => {
  it("emits a review snippet from the artifact", () => {
    const cap = listCapabilities()[0]!;
    const spec = emitPlaywrightSpec(cap);
    expect(spec).toContain(cap.metadata.name);
    expect(spec).toContain("Hands replay is the executor");
  });
});
