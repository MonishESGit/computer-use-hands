import type { Decision, LlmClient, LlmTurn } from "./llm.js";
import { compactObservation } from "./llm.js";

export const SYSTEM_PROMPT = `You are a computer-use agent driving a legacy teller workstation (Heritage Core).
You observe an accessibility snapshot (not a clean DOM) and choose one action at a time.

Rules:
- Prefer role+accessible name. Frames are named "header" and "main" after sign-on.
- Sign on with secret_ref teller_user / teller_password. Never invent other credentials.
- Member/customer identifiers from the goal are parameters (valueKind=parameter, parameterName=memberId).
- If you see a System Notice / scheduled maintenance, dismiss it with type=dismiss_dialog.
- When the CIF record with the savings balance is visible, status=success.
- If you cannot proceed safely, status=stuck with stuckReason.

Return ONLY JSON of this exact shape:
{
  "thought": "short reason",
  "status": "continue" | "success" | "stuck" | "failed",
  "action": null | {
    "type": "navigate" | "click" | "fill" | "select" | "press" | "dismiss_dialog" | "wait_for",
    "role": "textbox" | "button" | "link" | ...,
    "name": "accessible name",
    "frame": "header" | "main",
    "url": "only for navigate",
    "value": "only for fill",
    "valueKind": "literal" | "parameter" | "secret_ref",
    "parameterName": "memberId",
    "secretRef": "teller_user" | "teller_password"
  },
  "stuckReason": "optional",
  "successReason": "optional"
}
If status is success or stuck, action must be null.`;

export function userPrompt(turn: LlmTurn): string {
  return [
    `Goal: ${turn.goal}`,
    `The browser is already on the allowlisted target. Do not invent hostnames. Use the current page.`,
    `Sequence for this app: fill User ID (secret teller_user), fill Password (secret teller_password), click Sign On, dismiss OK if a System Notice appears, click Member Inquiry in the header, fill the member field (parameter memberId=12345), click Search. Do not repeat a completed fill.`,
    `Allowed: ${turn.allowedActions.join(", ")}`,
    `Prior thoughts: ${turn.history.slice(-8).join(" | ") || "(none)"}`,
    compactObservation(turn.observation),
  ].join("\n\n");
}

export class OpenAiClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.HANDS_MODEL ?? "gpt-4o",
  ) {}

  async decide(turn: LlmTurn): Promise<Decision> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey });
    const completion = await client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(turn) },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("empty model response");
    }
    const { DecisionSchema } = await import("./llm.js");
    const parsed = JSON.parse(content) as unknown;
    const normalized = normalizeDecision(parsed);
    return DecisionSchema.parse(normalized);
  }
}

function normalizeDecision(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.action === "string") {
    obj.action = {
      type: obj.action,
      role: obj.role,
      name: obj.name,
      frame: obj.frame,
      url: obj.url,
      value: obj.value,
      valueKind: obj.valueKind,
      parameterName: obj.parameterName,
      secretRef: obj.secretRef,
    };
  }
  if (obj.status === "continue" && obj.action === undefined) {
    obj.action = null;
  }
  if (!obj.thought || obj.thought === null) {
    obj.thought = typeof obj.reasoning === "string" ? obj.reasoning : "proceed";
  }
  if (obj.stuckReason === null) delete obj.stuckReason;
  if (obj.successReason === null) delete obj.successReason;
  return obj;
}
