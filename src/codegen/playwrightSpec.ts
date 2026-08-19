import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Capability } from "../artifact/schema.js";

export function emitPlaywrightSpec(capability: Capability): string {
  const fills = capability.spec.steps
    .filter((step) => step.action === "fill" && step.valueFrom?.kind === "parameter")
    .map((step) => `  // ${step.id}: fill parameter ${step.valueFrom && step.valueFrom.kind === "parameter" ? step.valueFrom.name : ""}`)
    .join("\n");
  return `import { test, expect } from "@playwright/test";

// Generated from Hands capability ${capability.metadata.name}@${capability.metadata.version}
// This is a readability aid, not the production runtime. Replay goes through src/replay.

test(${JSON.stringify(capability.metadata.title)}, async ({ page }) => {
  test.skip(true, "snippet generated for review; Hands replay is the executor");
${fills}
  expect(${JSON.stringify(capability.spec.success.checkpointId)}).toBeTruthy();
});
`;
}

export function writePlaywrightSpec(capability: Capability, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${capability.metadata.name}.spec.ts`);
  writeFileSync(file, emitPlaywrightSpec(capability), "utf8");
  return file;
}
