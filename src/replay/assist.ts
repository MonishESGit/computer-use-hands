import type { Step, Target } from "../artifact/schema.js";
import { actionAllowed, originAllowed, type Policy } from "../policy/enforce.js";
import type { Decision, LlmClient } from "../agent/llm.js";
import type { Observation } from "../surface/types.js";

/**
 * One policy-checked locator repair. Replay stays deterministic unless
 * the caller opts in with `--assist`; the model may not add steps.
 */
export async function repairStepTarget(options: {
  llm: LlmClient;
  step: Step;
  observation: Observation;
  policy: Policy;
}): Promise<Step | undefined> {
  const target = options.step.target;
  if (!target) {
    return undefined;
  }
  const decision = await options.llm.decide({
    goal: `Replay is stuck on "${options.step.action}" "${target.description}". Propose the correct accessibility role and name for that same control. Do not navigate off the allowlisted host. Do not invent a different flow.`,
    observation: options.observation,
    history: [`locator miss on ${options.step.id}`],
    allowedActions: options.policy.allow.actions,
  });
  const repaired = targetFromDecision(decision, target);
  if (!repaired) {
    return undefined;
  }
  const allowed = actionAllowed(options.policy, options.step.action);
  if (!allowed.ok) {
    return undefined;
  }
  if (options.observation.url) {
    const origin = originAllowed(options.policy, options.observation.url);
    if (!origin.ok) {
      return undefined;
    }
  }
  return { ...options.step, target: repaired };
}

function targetFromDecision(decision: Decision, fallback: Target): Target | undefined {
  const action = decision.action;
  if (decision.status !== "continue" || !action?.role || !action.name) {
    return undefined;
  }
  return {
    description: fallback.description,
    locators: [
      {
        strategy: "ax_role_name",
        role: action.role,
        name: action.name,
        frame: action.frame ? [action.frame] : fallback.locators[0]?.frame,
        confidence: 0.9,
      },
    ],
  };
}
