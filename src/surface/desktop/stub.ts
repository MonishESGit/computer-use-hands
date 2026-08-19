import { SurfaceNotImplemented, type ActionIntent, type Observation, type SurfaceDriver } from "../types.js";

/**
 * Desktop seam: same Observation / ActionIntent as web.
 * A future adapter would bind to OS accessibility (macOS AX, Windows UIA)
 * instead of Playwright frames. Replay stays locator-ranked AX names.
 */
export class DesktopDriver implements SurfaceDriver {
  readonly kind = "desktop" as const;

  async observe(): Promise<Observation> {
    throw new SurfaceNotImplemented("desktop");
  }

  async act(_intent: ActionIntent): Promise<never> {
    throw new SurfaceNotImplemented("desktop");
  }

  async screenshot(): Promise<never> {
    throw new SurfaceNotImplemented("desktop");
  }

  async classify(): Promise<never> {
    throw new SurfaceNotImplemented("desktop");
  }

  async dispose(): Promise<void> {}
}
