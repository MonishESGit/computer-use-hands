import type { Frame, Locator as PwLocator } from "playwright";
import type { Locator } from "../artifact/schema.js";
import { canonicalizeLocatorName, matchesAccessibleName } from "../artifact/canonicalize.js";
import { LocatorError } from "./types.js";

export function frameByChain(root: Frame, pageFrames: Frame[], chain: string[] | undefined): Frame {
  if (!chain || chain.length === 0) {
    return root;
  }
  let current: Frame = root;
  for (const name of chain) {
    const named = pageFrames.find((frame) => frame.name() === name);
    const child = current.childFrames().find((frame) => frame.name() === name);
    const next = named ?? child;
    if (!next) {
      throw new LocatorError("locator_miss", `frame ${chain.join(" / ")} not found`);
    }
    current = next;
  }
  return current;
}

export function toPlaywrightLocator(frame: Frame, loc: Locator): PwLocator {
  switch (loc.strategy) {
    case "ax_role_name": {
      const name = loc.namePattern ? new RegExp(`^(?:${loc.namePattern})$`) : loc.name;
      if (!loc.role || name === undefined) {
        throw new LocatorError("locator_miss", "ax_role_name missing role/name");
      }
      return frame.getByRole(loc.role as never, { name });
    }
    case "ax_role_value":
      return frame.getByRole(loc.role as never, { name: loc.text });
    case "label": {
      const name = loc.namePattern ? new RegExp(`^(?:${loc.namePattern})$`) : (loc.name ?? loc.text ?? "");
      return frame.getByLabel(name);
    }
    case "placeholder":
      return frame.getByPlaceholder(loc.namePattern ? new RegExp(loc.namePattern) : (loc.text ?? loc.name ?? ""));
    case "visible_text": {
      const name = loc.namePattern ? new RegExp(loc.namePattern) : (loc.text ?? loc.name ?? "");
      return frame.getByText(name);
    }
    case "structural_path":
      return frame.locator(loc.path ?? "xpath=/*[never]");
    case "css":
      return frame.locator(loc.css ?? "never");
    case "test_id":
      return frame.getByTestId(loc.testId ?? "never");
    default: {
      const _never: never = loc.strategy;
      return _never;
    }
  }
}

export async function firstUnique(locator: PwLocator, nth: number | undefined): Promise<PwLocator> {
  const count = await locator.count();
  if (count === 0) {
    throw new LocatorError("locator_miss", "no matches");
  }
  if (count > 1 && nth === undefined) {
    throw new LocatorError("ambiguous_target", `${count} matches without nth`);
  }
  return nth !== undefined ? locator.nth(nth) : locator.first();
}

export async function recordFromElement(el: PwLocator, frame: string[] | undefined): Promise<Locator[]> {
  const info = await el.evaluate((node) => {
    const html = node as HTMLElement;
    const input = node as HTMLInputElement;
    return {
      tag: html.tagName.toLowerCase(),
      type: html.getAttribute("type"),
      title: html.getAttribute("title"),
      accessible: html.getAttribute("aria-label"),
      text: (html.innerText || html.textContent || "").trim().slice(0, 80),
      value: input.value ?? "",
      placeholder: html.getAttribute("placeholder"),
    };
  });
  const role = inferRole(info.tag, info.type);
  const accName = info.accessible || info.title || info.text;
  const recorded: Locator[] = [];
  if (role && accName) {
    recorded.push(
      canonicalizeLocatorName({
        strategy: "ax_role_name",
        role,
        name: accName,
        frame,
        confidence: 0.95,
      }),
    );
  }
  if (info.title) {
    recorded.push(
      canonicalizeLocatorName({
        strategy: "ax_role_name",
        role: role ?? "textbox",
        name: info.title,
        frame,
        confidence: 0.9,
      }),
    );
  }
  if (info.text) {
    recorded.push({
      strategy: "visible_text",
      text: info.text,
      frame,
      confidence: 0.55,
    });
  }
  if (recorded.length === 0) {
    recorded.push({
      strategy: "css",
      css: info.tag,
      frame,
      confidence: 0.2,
    });
  }
  return recorded;
}

function inferRole(tag: string, type: string | null): string | undefined {
  if (tag === "a") {
    return "link";
  }
  if (tag === "button") {
    return "button";
  }
  if (tag === "select") {
    return "combobox";
  }
  if (tag === "textarea") {
    return "textbox";
  }
  if (tag === "input") {
    if (type === "submit" || type === "button") {
      return "button";
    }
    if (type === "password" || type === "text" || type === null || type === "") {
      return "textbox";
    }
  }
  return undefined;
}

export { matchesAccessibleName };
