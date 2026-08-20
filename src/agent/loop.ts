import type { Capability } from "../artifact/schema.js";
import { redactCapability } from "../policy/redact.js";
import type { Policy } from "../policy/enforce.js";
import { actionAllowed, originAllowed } from "../policy/enforce.js";
import type { RunLog } from "../evidence/run.js";
import type { LiveSession } from "../session/live.js";
import { LocatorError, type ActionIntent } from "../surface/types.js";
import { compileCapability, type RecordedTurn } from "./compile.js";
import type { Decision, LlmClient } from "./llm.js";
import { resolveValueFrom } from "../artifact/parameters.js";

export interface DiscoverOptions {
  goal: string;
  entryUrl: string;
  tenant: string;
  session: LiveSession;
  llm: LlmClient;
  policy: Policy;
  evidence: RunLog;
  secrets: Record<string, string>;
  maxSteps?: number;
  timeoutMs?: number;
  onStuck?: (reason: string) => Promise<void>;
}

export interface DiscoverResult {
  capability?: Capability;
  reason: string;
  status: "success" | "stuck" | "failed";
}

export async function discover(options: DiscoverOptions): Promise<DiscoverResult> {
  const maxSteps = options.maxSteps ?? 25;
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  const history: string[] = [];
  const turns: RecordedTurn[] = [];
  const allowed = options.policy.allow.actions;
  const origin = originAllowed(options.policy, options.entryUrl);
  if (!origin.ok) {
    return { status: "failed", reason: origin.reason };
  }
  await options.session.driver.act({ type: "navigate", url: options.entryUrl });
  turns.push({
    thought: "open the supplied target",
    intent: { type: "navigate", url: options.entryUrl },
    recordedLocators: [],
    valueKind: "literal",
  });
  options.evidence.event("act", { type: "navigate", url: options.entryUrl });

  for (let step = 0; step < maxSteps; step += 1) {
    if (Date.now() > deadline) {
      return { status: "failed", reason: "timeout" };
    }
    options.session.assertAutomation();
    const obs = await options.session.driver.observe();
    if (obs.url && obs.url !== "about:blank") {
      const origin = originAllowed(options.policy, obs.url);
      if (!origin.ok) {
        return { status: "failed", reason: origin.reason };
      }
    }
    const decision = await options.llm.decide({
      goal: options.goal,
      observation: obs,
      history,
      allowedActions: allowed,
    });
    history.push(decision.thought);
    const lastThoughts = history.filter((h) => h === decision.thought);
    if (lastThoughts.length >= 2) {
      history.push("HINT: that action was already taken. Take the next step (Password, Sign On, dismiss notice, or inquiry).");
    }
    options.evidence.event("decision", { thought: decision.thought, status: decision.status });

    if (decision.status === "success") {
      const capability = redactCapability(
        compileCapability({
          goal: options.goal,
          sourceRunId: options.evidence.runId,
          entryUrl: options.entryUrl,
          tenant: options.tenant,
          turns,
        }),
        options.policy,
      );
      options.evidence.writeJson("artifact.json", capability);
      return { status: "success", capability, reason: decision.successReason ?? "goal met" };
    }
    if (decision.status === "stuck" || decision.status === "failed") {
      options.session.pauseForHuman();
      const reason = decision.stuckReason ?? decision.status;
      if (options.onStuck) {
        await options.onStuck(reason);
      }
      return { status: "stuck", reason };
    }
    if (!decision.action) {
      return { status: "failed", reason: "continue without action" };
    }

    const intent = intentFrom(decision, options);
    const allowedAct = actionAllowed(options.policy, intent.type);
    if (!allowedAct.ok) {
      return { status: "failed", reason: allowedAct.reason };
    }
    if (intent.type === "navigate" && intent.url) {
      const dest = originAllowed(options.policy, intent.url);
      if (!dest.ok) {
        history.push(`blocked navigation: ${dest.reason}`);
        continue;
      }
    }
    try {
      const result = await options.session.driver.act(intent);
      turns.push({
        thought: decision.thought,
        intent,
        recordedLocators: result.recordedLocators,
        valueKind: decision.action.valueKind ?? undefined,
        parameterName: decision.action.parameterName ?? undefined,
        secretRef: decision.action.secretRef ?? undefined,
      });
      options.evidence.event("act", { type: intent.type, name: decision.action.name });
    } catch (err) {
      if (err instanceof LocatorError && obs.signatures.includes("unexpected_dialog")) {
        await options.session.driver.act({ type: "dismiss_dialog" });
        step -= 1;
        continue;
      }
      const shot = await options.session.driver.screenshot().catch(() => undefined);
      if (shot) {
        options.evidence.screenshot(`discover-${step}.png`, shot);
      }
      return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
  }
  return { status: "failed", reason: "max steps" };
}

function intentFrom(decision: Decision, options: DiscoverOptions): ActionIntent {
  const action = decision.action;
  if (!action) {
    throw new Error("no action");
  }
  const intent: ActionIntent = { type: action.type };
  if (action.url) {
    intent.url = action.url;
  }
    if (action.type === "fill") {
      const looksSecret =
        action.valueKind === "secret_ref" ||
        action.secretRef === "teller_user" ||
        action.secretRef === "teller_password" ||
        action.value === "teller_user" ||
        action.value === "teller_password";
      if (looksSecret) {
        const ref =
          action.secretRef ??
          (action.value === "teller_password" || /password/i.test(action.name ?? "")
            ? "teller_password"
            : "teller_user");
        intent.value = resolveValueFrom({ kind: "secret", ref }, {}, options.secrets);
      } else {
        intent.value = action.value ?? undefined;
      }
    }
  if (action.role && action.name) {
    intent.target = {
      description: action.name,
      locators: [
        {
          strategy: "ax_role_name",
          role: action.role,
          name: action.name,
          frame: action.frame ? [action.frame] : undefined,
          confidence: 0.9,
        },
      ],
    };
  }
  return intent;
}
