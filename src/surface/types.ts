import type { ErrorClass, Locator, Target } from "../artifact/schema.js";

export type SurfaceKind = "web" | "desktop";

export interface FrameObservation {
  name: string;
  url: string;
  ariaSnapshot: string;
  text: string;
}

export interface Observation {
  url: string;
  title: string;
  frames: FrameObservation[];
  combinedText: string;
  signatures: ErrorClass[];
}

export interface ActionIntent {
  type:
    | "navigate"
    | "click"
    | "fill"
    | "select"
    | "press"
    | "wait_for"
    | "extract"
    | "dismiss_dialog"
    | "switch_frame"
    | "assert_checkpoint"
    | "human_step";
  url?: string;
  target?: Target;
  value?: string;
  key?: string;
}

export interface ActionResult {
  ok: true;
  recordedLocators: Locator[];
  extractedText?: string;
}

export class LocatorError extends Error {
  readonly code: "locator_miss" | "ambiguous_target";
  constructor(code: "locator_miss" | "ambiguous_target", message: string) {
    super(message);
    this.name = "LocatorError";
    this.code = code;
  }
}

export class SurfaceNotImplemented extends Error {
  constructor(kind: SurfaceKind) {
    super(`${kind} surface driver is not implemented`);
    this.name = "SurfaceNotImplemented";
  }
}

export class NotInControlError extends Error {
  constructor() {
    super("automation is not in control of this session");
    this.name = "NotInControlError";
  }
}

export interface SurfaceDriver {
  readonly kind: SurfaceKind;
  observe(): Promise<Observation>;
  act(intent: ActionIntent): Promise<ActionResult>;
  screenshot(): Promise<Buffer>;
  classify(): Promise<ErrorClass[]>;
  dispose(): Promise<void>;
}
