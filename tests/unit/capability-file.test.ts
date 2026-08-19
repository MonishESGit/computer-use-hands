import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCapabilityFile } from "../../src/artifact/io.js";

describe("committed lookup capability", () => {
  it("parses as a Hands v1 artifact", () => {
    const cap = loadCapabilityFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../capabilities/lookup_member_savings_balance.json"),
    );
    expect(cap.metadata.tenant.mode).toBe("canonical");
    expect(cap.spec.exceptionHandlers.some((h) => h.then.kind === "business_outcome")).toBe(true);
  });
});
