import type { Page } from "playwright";
import type { ErrorClass, Locator, Target } from "../../artifact/schema.js";
import { classifyText } from "../classify.js";
import { firstUnique, frameByChain, recordFromElement, toPlaywrightLocator } from "../locators.js";
import {
  LocatorError,
  type ActionIntent,
  type ActionResult,
  type Observation,
  type SurfaceDriver,
} from "../types.js";

const DISMISS_NAMES = /^(OK|Close|Continue|Dismiss|Cancel)$/i;

export class WebPlaywrightDriver implements SurfaceDriver {
  readonly kind = "web" as const;

  constructor(private readonly page: Page) {}

  async observe(): Promise<Observation> {
    const frames = [];
    for (const frame of this.page.frames()) {
      const name = frame.name() || (frame === this.page.mainFrame() ? "_top" : "");
      let ariaSnapshot = "";
      let text = "";
      try {
        ariaSnapshot = await frame.locator("body").ariaSnapshot({ timeout: 800 });
      } catch {
        ariaSnapshot = "";
      }
      try {
        text = await frame.locator("body").innerText({ timeout: 800 });
      } catch {
        text = "";
      }
      frames.push({ name, url: frame.url(), ariaSnapshot, text });
    }
    const combinedText = frames.map((frame) => frame.text).join("\n");
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      frames,
      combinedText,
      signatures: classifyText(combinedText),
    };
  }

  async classify(): Promise<ErrorClass[]> {
    const obs = await this.observe();
    return obs.signatures;
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ fullPage: true });
  }

  async act(intent: ActionIntent): Promise<ActionResult> {
    switch (intent.type) {
      case "navigate": {
        if (!intent.url) {
          throw new Error("navigate requires url");
        }
        await this.page.goto(intent.url, { waitUntil: "domcontentloaded" });
        await this.settle();
        return { ok: true, recordedLocators: [] };
      }
      case "click":
      case "fill":
      case "select":
      case "press":
      case "extract": {
        const { handle, recorded } = await this.resolve(intent.target);
        if (intent.type === "fill") {
          await handle.fill(intent.value ?? "");
        } else if (intent.type === "select") {
          await handle.selectOption(intent.value ?? "");
        } else if (intent.type === "press") {
          await handle.press(intent.key ?? intent.value ?? "Enter");
        } else if (intent.type === "click") {
          await handle.click();
        }
        const extractedText = intent.type === "extract" ? (await handle.innerText()).trim() : undefined;
        await this.settle();
        return { ok: true, recordedLocators: recorded, extractedText };
      }
      case "dismiss_dialog": {
        const recorded = await this.dismiss();
        await this.settle();
        return { ok: true, recordedLocators: recorded };
      }
      case "wait_for":
        await this.settle();
        return { ok: true, recordedLocators: [] };
      case "switch_frame":
        return { ok: true, recordedLocators: [] };
      case "assert_checkpoint":
      case "human_step":
        return { ok: true, recordedLocators: [] };
      default: {
        const _never: never = intent.type;
        return _never;
      }
    }
  }

  async dispose(): Promise<void> {
    // The LiveSession owns the browser.
  }

  async resolve(target: Target | undefined): Promise<{ handle: import("playwright").Locator; recorded: Locator[] }> {
    if (!target) {
      throw new LocatorError("locator_miss", "action is missing a target");
    }
    let last: LocatorError = new LocatorError("locator_miss", `unresolved: ${target.description}`);
    for (const loc of target.locators) {
      try {
        let frame: import("playwright").Frame;
        try {
          frame = frameByChain(this.page.mainFrame(), this.page.frames(), loc.frame);
        } catch {
          frame = this.page.mainFrame();
        }
        const found = await firstUnique(toPlaywrightLocator(frame, loc), loc.nth);
        const recorded = await recordFromElement(found, loc.frame);
        return { handle: found, recorded };
      } catch (err) {
        if (err instanceof LocatorError) {
          last = err;
          continue;
        }
        throw err;
      }
    }
    throw last;
  }

  private async dismiss(): Promise<Locator[]> {
    for (const frame of this.page.frames()) {
      const button = frame.getByRole("button", { name: DISMISS_NAMES });
      if ((await button.count()) > 0) {
        const handle = button.first();
        const recorded = await recordFromElement(handle, frame.name() ? [frame.name()] : undefined);
        await handle.click();
        return recorded;
      }
    }
    return [];
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await this.page.waitForTimeout(150);
  }
}
