import { randomUUID } from "node:crypto";
import { canonicalizeLocatorName } from "../artifact/canonicalize.js";
import type { Capability, Locator, Step } from "../artifact/schema.js";
import { parseCapability } from "../artifact/io.js";
import type { ActionIntent } from "../surface/types.js";

export interface RecordedTurn {
  thought: string;
  intent: ActionIntent;
  recordedLocators: Locator[];
  valueKind?: "literal" | "parameter" | "secret_ref";
  parameterName?: string;
  secretRef?: string;
}

const DEFAULT_HANDLERS = [
  {
    id: "h_notice",
    when: { match: "unexpected_dialog" as const },
    then: { kind: "recover" as const, steps: [{ id: "r_ok", action: "dismiss_dialog" as const, risk: "safe" as const }] },
  },
  {
    id: "h_not_found",
    when: { match: "not_found" as const },
    then: {
      kind: "business_outcome" as const,
      code: "MEMBER_NOT_FOUND" as const,
      message: "No CIF record for this identifier",
    },
  },
  {
    id: "h_validation",
    when: { match: "validation_error" as const },
    then: {
      kind: "business_outcome" as const,
      code: "VALIDATION_ERROR" as const,
      message: "Identifier failed core validation",
    },
  },
  {
    id: "h_denied",
    when: { match: "permission_denied" as const },
    then: {
      kind: "business_outcome" as const,
      code: "PERMISSION_DENIED" as const,
      message: "Teller is not authorized for this product action",
    },
  },
  {
    id: "h_expired",
    when: { match: "session_expired" as const },
    then: { kind: "fail" as const, code: "SESSION_EXPIRED" },
  },
];

export function compileCapability(options: {
  goal: string;
  sourceRunId: string;
  entryUrl: string;
  tenant: string;
  turns: RecordedTurn[];
}): Capability {
  const steps: Step[] = [];
  let i = 1;
  for (const turn of options.turns) {
    if (turn.intent.type === "wait_for") {
      continue;
    }
    const locators = (turn.recordedLocators.length > 0
      ? turn.recordedLocators
      : intentLocators(turn)).map((loc) => canonicalizeLocatorName(loc));
    const step: Step = {
      id: `s${i}`,
      action: turn.intent.type === "dismiss_dialog" ? "dismiss_dialog" : turn.intent.type,
      risk: "safe",
    };
    if (turn.intent.type === "navigate") {
      step.valueFrom = { kind: "literal", value: turn.intent.url ?? options.entryUrl };
    } else if (turn.intent.type !== "dismiss_dialog") {
      step.target = {
        description: turn.intent.target?.description ?? turn.thought,
        locators: locators.length > 0 ? locators : intentLocators(turn),
      };
    }
    if (turn.valueKind === "parameter" && turn.parameterName) {
      step.valueFrom = { kind: "parameter", name: turn.parameterName };
    } else if (turn.valueKind === "secret_ref" && turn.secretRef) {
      step.valueFrom = { kind: "secret", ref: turn.secretRef };
    } else if (turn.intent.type === "fill" && turn.intent.value) {
      step.valueFrom = { kind: "literal", value: turn.intent.value };
    }
    if (turn.intent.type === "click" && /search/i.test(turn.intent.target?.description ?? turn.intent.target?.locators[0]?.name ?? "")) {
      step.checkpoint = { id: "on_member_detail", kind: "text_includes", value: "CIF record", frame: ["main"] };
    }
    steps.push(step);
    i += 1;
  }
  if (!steps.some((step) => step.checkpoint?.id === "on_member_detail") && steps[steps.length - 1]) {
    steps[steps.length - 1]!.checkpoint = {
      id: "on_member_detail",
      kind: "text_includes",
      value: "CIF record",
      frame: ["main"],
    };
  }

  const draft = {
    apiVersion: "hands/v1" as const,
    kind: "Capability" as const,
    metadata: {
      id: randomUUID(),
      name: "lookup_member_savings_balance",
      title: "Look up member savings balance",
      description: options.goal,
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      sourceRunId: options.sourceRunId,
      status: "draft" as const,
      vendorApp: { id: "heritage-core", version: "1.0.0" },
      tenant: { mode: "canonical" as const },
      surfaceKind: "web" as const,
      tags: ["heritage-core", "inquiry", "discovered"],
    },
    spec: {
      entry: { urlTemplate: options.entryUrl.replace(/first-federal|riverside/, "{{tenant}}").replace(/:\d+/, ":{{port}}"), surface: "web" as const },
      parameters: [
        {
          name: "tenant",
          type: "enum" as const,
          required: true,
          description: "Institution path prefix",
          pii: "none" as const,
          enumValues: ["first-federal", "riverside"],
        },
        {
          name: "memberId",
          type: "string" as const,
          required: true,
          description: "Five-digit member/customer number",
          pii: "identifier" as const,
        },
        {
          name: "port",
          type: "number" as const,
          required: false,
          description: "Heritage Core port",
          pii: "none" as const,
          default: 3401,
        },
      ],
      outputs: [
        {
          name: "memberName",
          type: "string" as const,
          description: "Name on the CIF record",
          pii: "identifier" as const,
          extractor: {
            parse: "text" as const,
            from: {
              description: "Name cell",
              locators: [
                { strategy: "structural_path" as const, path: 'tr:has-text("Member Name") >> td >> nth=1', frame: ["main"], confidence: 0.8 },
                { strategy: "structural_path" as const, path: 'tr:has-text("Customer Name") >> td >> nth=1', frame: ["main"], confidence: 0.8 },
              ],
            },
          },
        },
        {
          name: "savingsBalance",
          type: "number" as const,
          description: "Savings balance",
          pii: "none" as const,
          extractor: {
            parse: "currency" as const,
            from: {
              description: "Balance cell",
              locators: [
                { strategy: "structural_path" as const, path: 'tr:has-text("Share Balance") >> td >> nth=1', frame: ["main"], confidence: 0.8 },
                { strategy: "structural_path" as const, path: 'tr:has-text("Current Savings") >> td >> nth=1', frame: ["main"], confidence: 0.8 },
              ],
            },
          },
        },
      ],
      success: { type: "checkpoint" as const, checkpointId: "on_member_detail" },
      steps,
      exceptionHandlers: DEFAULT_HANDLERS,
    },
  };
  return parseCapability(draft);
}

function intentLocators(turn: RecordedTurn): Locator[] {
  return turn.intent.target?.locators ?? [];
}
