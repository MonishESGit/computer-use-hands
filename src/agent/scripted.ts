import type { Decision, LlmClient, LlmTurn } from "./llm.js";

/** Deterministic stand-in so the observe→decide→act loop is testable without a model key. */
export class ScriptedClient implements LlmClient {
  constructor(private readonly script: Decision[]) {}

  async decide(_turn: LlmTurn): Promise<Decision> {
    const next = this.script.shift();
    if (!next) {
      return { thought: "script exhausted", status: "stuck", action: null, stuckReason: "no more scripted actions" };
    }
    return next;
  }
}

export function heritageLookupScript(_baseUrl: string, memberId: string): Decision[] {
  return [
    {
      thought: "Enter teller id from secret store",
      status: "continue",
      action: { type: "fill", role: "textbox", name: "User ID", valueKind: "secret_ref", secretRef: "teller_user" },
    },
    {
      thought: "Enter teller password from secret store",
      status: "continue",
      action: { type: "fill", role: "textbox", name: "Password", valueKind: "secret_ref", secretRef: "teller_password" },
    },
    { thought: "Sign on", status: "continue", action: { type: "click", role: "button", name: "Sign On" } },
    { thought: "Dismiss maintenance notice if present", status: "continue", action: { type: "dismiss_dialog" } },
    {
      thought: "Open inquiry",
      status: "continue",
      action: { type: "click", role: "link", name: "Member Inquiry", frame: "header" },
    },
    {
      thought: "Fill member id from the goal",
      status: "continue",
      action: {
        type: "fill",
        role: "textbox",
        name: "Member Number",
        frame: "main",
        value: memberId,
        valueKind: "parameter",
        parameterName: "memberId",
      },
    },
    { thought: "Search", status: "continue", action: { type: "click", role: "button", name: "Search", frame: "main" } },
    { thought: "CIF record is visible", status: "success", action: null, successReason: "savings balance on screen" },
  ];
}
