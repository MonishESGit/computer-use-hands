import { z } from "zod";
import type { Observation } from "../surface/types.js";

export const DecisionSchema = z.object({
  thought: z.string(),
  status: z.enum(["continue", "success", "stuck", "failed"]),
  action: z
    .object({
      type: z.enum([
        "navigate",
        "click",
        "fill",
        "select",
        "press",
        "dismiss_dialog",
        "wait_for",
      ]),
      role: z.string().nullish(),
      name: z.string().nullish(),
      frame: z.string().nullish(),
      url: z.string().nullish(),
      value: z.string().nullish(),
      valueKind: z.enum(["literal", "parameter", "secret_ref"]).nullish(),
      parameterName: z.string().nullish(),
      secretRef: z.string().nullish(),
    })
    .nullable(),
  stuckReason: z.string().nullish(),
  successReason: z.string().nullish(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export interface LlmTurn {
  goal: string;
  observation: Observation;
  history: string[];
  allowedActions: string[];
}

export interface LlmClient {
  decide(turn: LlmTurn): Promise<Decision>;
}

export function compactObservation(obs: Observation): string {
  const frames = obs.frames
    .map((frame) => `frame ${frame.name || "_top"} (${frame.url})\n${frame.ariaSnapshot || frame.text.slice(0, 1500)}`)
    .join("\n---\n");
  return `url: ${obs.url}\ntitle: ${obs.title}\nsignatures: ${obs.signatures.join(", ") || "(none)"}\n${frames}`.slice(0, 12_000);
}
