import type { Capability, Locator, Step, Target } from "./schema.js";
import { canonicalizeLocatorName } from "./canonicalize.js";
import { parseCapability } from "./io.js";

/**
 * Turn a raw discovery recording into something replay can trust:
 * drop duplicate fills, rewrite the entry URL to the template, strip
 * `_top` frames, and replace weak `css: input` clicks with AX names.
 *
 * Locators are still recordings — this does not invent a new flow.
 */
export function polishCapability(capability: Capability): Capability {
  const urlTemplate = capability.spec.entry.urlTemplate;
  const polished = compactDuplicateSteps(
    capability.spec.steps.map((step) => polishStep(step, urlTemplate)),
  );
  const steps = polished.map((step, index) => ({ ...step, id: `s${index + 1}` }));
  return parseCapability({
    ...capability,
    spec: { ...capability.spec, steps },
  });
}

export function compactDuplicateSteps(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    const prev = out[out.length - 1];
    if (prev && isRedundantFill(prev, step)) {
      continue;
    }
    out.push(step);
  }
  return out;
}

function isRedundantFill(a: Step, b: Step): boolean {
  if (a.action !== "fill" || b.action !== "fill") {
    return false;
  }
  const aKey = `${a.target?.description ?? ""}:${JSON.stringify(a.valueFrom)}`;
  const bKey = `${b.target?.description ?? ""}:${JSON.stringify(b.valueFrom)}`;
  return aKey === bKey;
}

function polishStep(step: Step, urlTemplate: string): Step {
  if (step.action === "navigate" && step.valueFrom?.kind === "literal") {
    return { ...step, valueFrom: { kind: "literal", value: urlTemplate } };
  }
  if (!step.target) {
    return step;
  }
  const login = isLoginControl(step.target);
  let locators = dedupeLocators(
    step.target.locators
      .map((loc) => withFrame(loc, login ? undefined : dropNoiseFrames(loc.frame)))
      .map((loc) => canonicalizeLocatorName(loc)),
  );
  locators = locators.filter((loc) => !isWeakCss(loc) || locators.every((other) => isWeakCss(other)));
  if (isWeakBundle(locators)) {
    const recovered = locatorsFromDescription(step.target, login);
    if (recovered.length > 0) {
      locators = recovered;
    }
  }
  return {
    ...step,
    target: { ...step.target, locators },
  };
}

function isLoginControl(target: Target): boolean {
  const blob = `${target.description} ${target.locators.map((loc) => loc.name ?? loc.text ?? "").join(" ")}`;
  return /\b(user id|password|sign on)\b/i.test(blob);
}

function dropNoiseFrames(frame: string[] | undefined): string[] | undefined {
  const next = (frame ?? []).filter((name) => name && name !== "_top" && name !== "top");
  return next.length > 0 ? next : undefined;
}

function withFrame(loc: Locator, frame: string[] | undefined): Locator {
  const next = { ...loc };
  if (frame && frame.length > 0) {
    next.frame = frame;
  } else {
    delete next.frame;
  }
  return next;
}

function isWeakCss(loc: Locator): boolean {
  return loc.strategy === "css" && loc.confidence <= 0.3 && (loc.css === "input" || loc.css === "button");
}

function isWeakBundle(locators: Locator[]): boolean {
  if (locators.length === 0) {
    return true;
  }
  return Math.max(...locators.map((loc) => loc.confidence)) < 0.5;
}

interface KnownControl {
  match: RegExp;
  role: string;
  name: string;
  frame?: string[];
}

const KNOWN_CONTROLS: readonly KnownControl[] = [
  { match: /sign on/i, role: "button", name: "Sign On" },
  { match: /^search$/i, role: "button", name: "Search", frame: ["main"] },
  { match: /member inquiry|customer inquiry/i, role: "link", name: "Member Inquiry", frame: ["header"] },
  { match: /open auxiliary|open sub-account/i, role: "link", name: "Open Auxiliary Share", frame: ["header"] },
  { match: /^submit$/i, role: "button", name: "Submit", frame: ["main"] },
  { match: /user id/i, role: "textbox", name: "User ID" },
  { match: /^password$/i, role: "textbox", name: "Password" },
  { match: /member number|customer no/i, role: "textbox", name: "Member Number", frame: ["main"] },
];

function locatorsFromDescription(target: Target, login: boolean): Locator[] {
  const blob = `${target.description} ${target.locators.map((loc) => loc.name ?? loc.text ?? loc.css ?? "").join(" ")}`;
  const known = KNOWN_CONTROLS.find((entry) => entry.match.test(blob) || entry.match.test(target.description));
  if (!known) {
    return [];
  }
  return [
    canonicalizeLocatorName({
      strategy: "ax_role_name",
      role: known.role,
      name: known.name,
      frame: login ? undefined : known.frame,
      confidence: 0.95,
    }),
  ];
}

function dedupeLocators(locators: Locator[]): Locator[] {
  const best = new Map<string, Locator>();
  for (const loc of locators) {
    const key = locatorKey(loc);
    const existing = best.get(key);
    if (!existing || loc.confidence > existing.confidence) {
      best.set(key, loc);
    }
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

function locatorKey(loc: Locator): string {
  return JSON.stringify({
    strategy: loc.strategy,
    role: loc.role,
    name: loc.name,
    namePattern: loc.namePattern,
    text: loc.text,
    path: loc.path,
    css: loc.css,
    testId: loc.testId,
    frame: loc.frame ?? [],
    nth: loc.nth,
  });
}
