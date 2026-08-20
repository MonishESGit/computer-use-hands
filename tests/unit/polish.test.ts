import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCapabilityFile } from "../../src/artifact/io.js";
import { polishCapability } from "../../src/artifact/polish.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("discovery polish", () => {
  it("drops duplicate fills, templates the entry URL, and upgrades weak submit locators", () => {
    const raw = loadCapabilityFile(
      path.join(root, "evidence/runs/discovery-llm-success/artifact.json"),
    );
    const polished = polishCapability(raw);

    expect(polished.spec.steps.map((step) => `${step.action}:${step.target?.description ?? ""}`)).toEqual([
      "navigate:",
      "fill:User ID",
      "fill:Password",
      "click:Sign On",
      "dismiss_dialog:",
      "click:Member Inquiry",
      "fill:Member Number",
      "click:Search",
    ]);

    const nav = polished.spec.steps[0];
    expect(nav?.valueFrom).toEqual({
      kind: "literal",
      value: "http://127.0.0.1:{{port}}/t/{{tenant}}/login",
    });

    const signOn = polished.spec.steps.find((step) => step.target?.description === "Sign On");
    expect(signOn?.target?.locators[0]).toMatchObject({
      strategy: "ax_role_name",
      role: "button",
      name: "Sign On",
    });
    expect(signOn?.target?.locators[0]?.frame).toBeUndefined();

    const search = polished.spec.steps.find((step) => step.target?.description === "Search");
    expect(search?.target?.locators[0]).toMatchObject({
      strategy: "ax_role_name",
      role: "button",
      name: "Search",
      frame: ["main"],
    });

    for (const step of polished.spec.steps) {
      for (const loc of step.target?.locators ?? []) {
        expect(loc.frame ?? []).not.toContain("_top");
        expect(loc.css).not.toBe("input");
      }
    }
  });

  it("is idempotent", () => {
    const raw = loadCapabilityFile(
      path.join(root, "evidence/runs/discovery-llm-success/artifact.json"),
    );
    const once = polishCapability(raw);
    expect(polishCapability(once)).toEqual(once);
  });
});
