import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { NotInControlError } from "../surface/types.js";
import { WebPlaywrightDriver } from "../surface/web/playwright.js";

export type ControlOwner = "automation" | "human";

export interface LiveSessionOptions {
  headed?: boolean;
  slowMo?: number;
}

export interface HumanAction {
  at: string;
  type: "click" | "fill" | "navigation";
  detail: string;
}

export class LiveSession {
  control: { owner: ControlOwner } = { owner: "automation" };
  readonly driver: WebPlaywrightDriver;
  readonly humanLog: HumanAction[] = [];

  private constructor(
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {
    this.driver = new WebPlaywrightDriver(page);
  }

  static async launch(options: LiveSessionOptions = {}): Promise<LiveSession> {
    const browser = await chromium.launch({
      headless: options.headed !== true,
      slowMo: options.slowMo,
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const session = new LiveSession(browser, context, page);
    await session.installHumanBridge();
    return session;
  }

  assertAutomation(): void {
    if (this.control.owner !== "automation") {
      throw new NotInControlError();
    }
  }

  pauseForHuman(): void {
    this.control.owner = "human";
  }

  resume(): void {
    this.control.owner = "automation";
  }

  private async installHumanBridge(): Promise<void> {
    await this.page.exposeBinding("handsRecordHuman", (_source, payload: HumanAction) => {
      if (this.control.owner === "human") {
        this.humanLog.push(payload);
      }
    });
    await this.page.addInitScript(() => {
      document.addEventListener(
        "click",
        (event) => {
          const el = event.target as HTMLElement | null;
          const detail = (el?.getAttribute("title") || el?.innerText || el?.tagName || "click").slice(0, 80);
          const record = (window as unknown as { handsRecordHuman: (p: HumanAction) => void }).handsRecordHuman;
          record({ at: new Date().toISOString(), type: "click", detail });
        },
        true,
      );
    });
    this.page.on("framenavigated", (frame) => {
      if (this.control.owner === "human" && frame === this.page.mainFrame()) {
        this.humanLog.push({ at: new Date().toISOString(), type: "navigation", detail: frame.url() });
      }
    });
  }

  async dispose(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}
