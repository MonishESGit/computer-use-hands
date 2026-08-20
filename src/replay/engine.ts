import type { Capability, ExceptionHandler, RunResult, Step } from "../artifact/schema.js";
import { interpolate, resolveParameters, resolveValueFrom, type ParamValues } from "../artifact/parameters.js";
import type { Policy } from "../policy/enforce.js";
import {
  actionAllowed,
  originAllowed,
  isIrreversibleName,
  unattendedIrreversibleAllowed,
} from "../policy/enforce.js";
import type { RunLog } from "../evidence/run.js";
import type { LiveSession } from "../session/live.js";
import { LocatorError, type ActionIntent } from "../surface/types.js";
import type { LlmClient } from "../agent/llm.js";
import { checkpointHolds, parseExtracted } from "./extract.js";
import { repairStepTarget } from "./assist.js";

export interface ReplayOptions {
  capability: Capability;
  params: ParamValues;
  extras?: ParamValues;
  secrets: Record<string, string>;
  policy: Policy;
  session: LiveSession;
  evidence: RunLog;
  onEscalate?: (reason: string) => Promise<"resume" | "abort" | "complete">;
  /** Off by default. One policy-checked locator repair, then replay continues. */
  assist?: LlmClient;
}

export async function replay(options: ReplayOptions): Promise<RunResult> {
  const started = Date.now();
  const { capability, policy, session, evidence } = options;
  const runId = evidence.runId;
  const params = resolveParameters(capability, options.params, options.extras ?? {});
  const entryUrl = interpolate(capability.spec.entry.urlTemplate, params);

  const fail = (
    stepId: string,
    expected: string,
    observed: string,
    klass: "hard" | "timeout" | "policy_violation" = "hard",
  ): RunResult => {
    const result: RunResult = {
      status: "failed",
      runId,
      durationMs: Date.now() - started,
      class: klass,
      stepId,
      expected,
      observed,
      evidenceDir: evidence.dir,
    };
    evidence.finish(result);
    return result;
  };

  const origin = originAllowed(policy, entryUrl);
  if (!origin.ok) {
    return fail("entry", "allowlisted origin", origin.reason, "policy_violation");
  }

  evidence.event("replay_start", { capability: capability.metadata.name, params: { ...params } });
  const recovered = new Set<string>();
  const steps = capability.spec.steps;
  let assistUsed = false;

  for (let i = 0; i < steps.length; ) {
    const step = steps[i];
    if (!step) {
      break;
    }
    session.assertAutomation();

    const before = await applyPageHandlers(
      "before",
      step,
      capability,
      options,
      recovered,
      fail,
      started,
      session,
      evidence,
    );
    if (before.kind === "return") {
      return before.result;
    }
    if (before.kind === "continue_same") {
      continue;
    }

    const allowed = actionAllowed(policy, step.action);
    if (!allowed.ok) {
      return fail(step.id, "allowlisted action", allowed.reason, "policy_violation");
    }

    const targetName = step.target?.locators[0]?.name ?? step.target?.description ?? "";
    if (step.risk === "irreversible" || isIrreversibleName(policy, targetName)) {
      const gate = unattendedIrreversibleAllowed(policy, capability.metadata.status);
      if (!gate.ok) {
        return fail(step.id, "approved capability", gate.reason, "policy_violation");
      }
    }

    try {
      await executeStep(step, params, options.secrets, session);
    } catch (err) {
      await captureShot(session, evidence, `${step.id}.png`);
      if (err instanceof LocatorError && options.assist && !assistUsed) {
        assistUsed = true;
        const obs = await session.driver.observe();
        const repaired = await repairStepTarget({
          llm: options.assist,
          step,
          observation: obs,
          policy,
        });
        evidence.event("assist", {
          stepId: step.id,
          repaired: Boolean(repaired),
          description: repaired?.target?.description,
        });
        if (repaired) {
          try {
            await executeStep(repaired, params, options.secrets, session);
          } catch (retryErr) {
            await captureShot(session, evidence, `${step.id}-assist.png`);
            if (retryErr instanceof LocatorError) {
              return fail(step.id, step.target?.description ?? step.action, retryErr.message);
            }
            return fail(step.id, step.action, retryErr instanceof Error ? retryErr.message : String(retryErr));
          }
        } else {
          return fail(step.id, step.target?.description ?? step.action, err.message);
        }
      } else if (err instanceof LocatorError) {
        return fail(step.id, step.target?.description ?? step.action, err.message);
      } else {
        return fail(step.id, step.action, err instanceof Error ? err.message : String(err));
      }
    }

    const afterHandlers = await applyPageHandlers(
      "after",
      step,
      capability,
      options,
      recovered,
      fail,
      started,
      session,
      evidence,
    );
    if (afterHandlers.kind === "return") {
      return afterHandlers.result;
    }
    if (afterHandlers.kind === "continue_same") {
      continue;
    }

    if (step.checkpoint) {
      const after = await session.driver.observe();
      if (!checkpointHolds(after, step.checkpoint)) {
        await captureShot(session, evidence, `${step.id}.png`);
        return fail(step.id, `checkpoint ${step.checkpoint.id}: ${step.checkpoint.value}`, after.combinedText.slice(0, 400));
      }
    }

    i += 1;
  }

  const outputs: Record<string, string | number | boolean> = {};
  for (const output of capability.spec.outputs) {
    try {
      const extracted = await session.driver.act({
        type: "extract",
        target: output.extractor.from,
      });
      outputs[output.name] = parseExtracted(extracted.extractedText ?? "", output.extractor.parse);
    } catch (err) {
      await captureShot(session, evidence, "extract.png");
      return fail("extract", output.name, err instanceof Error ? err.message : String(err));
    }
  }

  const successCp = capability.spec.steps
    .map((step) => step.checkpoint)
    .find((cp) => cp && cp.id === capability.spec.success.checkpointId);
  if (successCp) {
    const obs = await session.driver.observe();
    if (!checkpointHolds(obs, successCp)) {
      await captureShot(session, evidence, "success.png");
      return fail("success", successCp.value, obs.combinedText.slice(0, 400));
    }
  }

  const result: RunResult = {
    status: "success",
    runId,
    durationMs: Date.now() - started,
    stepsCompleted: steps.length,
    outputs,
  };
  evidence.event("replay_success", { outputs });
  evidence.finish(result);
  return result;
}

async function applyPageHandlers(
  phase: "before" | "after",
  step: Step,
  capability: Capability,
  options: ReplayOptions,
  recovered: Set<string>,
  fail: (stepId: string, expected: string, observed: string, klass?: "hard" | "timeout" | "policy_violation") => RunResult,
  started: number,
  session: LiveSession,
  evidence: RunLog,
): Promise<HandlerFlow> {
  const obs = await session.driver.observe();
  evidence.event("observe", {
    stepId: step.id,
    url: obs.url,
    signatures: obs.signatures,
    phase,
  });
  const urlCheck = originAllowed(options.policy, obs.url);
  if (!urlCheck.ok && obs.url && obs.url !== "about:blank") {
    await captureShot(session, evidence, `${step.id}.png`);
    return {
      kind: "return",
      result: fail(step.id, "allowlisted origin", urlCheck.reason, "policy_violation"),
    };
  }
  const handler = matchHandler(capability.spec.exceptionHandlers, step.id, obs.signatures, obs.combinedText);
  if (!handler) {
    return { kind: "next" };
  }
  evidence.event("handler", { stepId: step.id, handlerId: handler.id, match: handler.when.match, phase });
  return applyHandler(handler, step, options, recovered, fail, started, phase);
}

type HandlerFlow = { kind: "return"; result: RunResult } | { kind: "continue_same" } | { kind: "next" };

async function applyHandler(
  handler: ExceptionHandler,
  step: Step,
  options: ReplayOptions,
  recovered: Set<string>,
  fail: (stepId: string, expected: string, observed: string, klass?: "hard" | "timeout" | "policy_violation") => RunResult,
  started: number,
  phase: "before" | "after",
): Promise<HandlerFlow> {
  const { then } = handler;
  const { evidence, session } = options;
  switch (then.kind) {
    case "business_outcome": {
      await captureShot(session, evidence, `outcome-${then.code}.png`);
      const result: RunResult = {
        status: "business_outcome",
        runId: evidence.runId,
        durationMs: Date.now() - started,
        code: then.code,
        message: then.message,
        evidenceDir: evidence.dir,
      };
      evidence.finish(result);
      return { kind: "return", result };
    }
    case "fail":
      await captureShot(session, evidence, `${step.id}.png`);
      return {
        kind: "return",
        result: fail(step.id, then.code, handler.when.match),
      };
    case "escalate": {
      await captureShot(session, evidence, "escalated.png");
      if (options.onEscalate) {
        session.pauseForHuman();
        const decision = await options.onEscalate(then.reason);
        session.resume();
        if (decision === "resume") {
          return { kind: "continue_same" };
        }
        if (decision === "complete") {
          const result: RunResult = {
            status: "success",
            runId: evidence.runId,
            durationMs: Date.now() - started,
            stepsCompleted: 0,
            outputs: {},
          };
          evidence.finish(result);
          return { kind: "return", result };
        }
      }
      const result: RunResult = {
        status: "escalated",
        runId: evidence.runId,
        durationMs: Date.now() - started,
        interventionId: `int_${evidence.runId}`,
        reason: then.reason,
        evidenceDir: evidence.dir,
      };
      evidence.finish(result);
      return { kind: "return", result };
    }
    case "retry":
      return { kind: "continue_same" };
    case "recover": {
      const key = `${phase}:${step.id}:${handler.id}`;
      if (recovered.has(key)) {
        return { kind: "next" };
      }
      recovered.add(key);
      for (const recoverStep of then.steps) {
        await executeStep(recoverStep, {}, options.secrets, session);
      }
      // A dialog that blocked the current step should be retried; one that
      // appeared because the step already navigated should not re-run it.
      return { kind: phase === "before" ? "continue_same" : "next" };
    }
    default: {
      const _never: never = then;
      return _never;
    }
  }
}

function matchHandler(
  handlers: ExceptionHandler[],
  stepId: string,
  signatures: string[],
  combinedText: string,
): ExceptionHandler | undefined {
  return handlers.find((handler) => {
    if (handler.when.stepId && handler.when.stepId !== stepId) {
      return false;
    }
    if (!signatures.includes(handler.when.match)) {
      return false;
    }
    if (handler.when.textMatches?.length) {
      return handler.when.textMatches.some((needle) => combinedText.includes(needle));
    }
    return true;
  });
}

async function executeStep(
  step: Step,
  params: ParamValues,
  secrets: Record<string, string>,
  session: LiveSession,
): Promise<void> {
  const intent: ActionIntent = { type: step.action };
  if (step.target) {
    intent.target = step.target;
  }
  if (step.action === "navigate") {
    const raw = step.valueFrom ? resolveValueFrom(step.valueFrom, params, secrets) : "";
    intent.url = raw.includes("{{") ? interpolate(raw, params) : raw;
  } else if (step.valueFrom) {
    intent.value = resolveValueFrom(step.valueFrom, params, secrets);
  }
  await session.driver.act(intent);
}

async function captureShot(session: LiveSession, evidence: RunLog, name: string): Promise<void> {
  try {
    const shot = await session.driver.screenshot();
    evidence.screenshot(name, shot);
  } catch {
    evidence.event("screenshot_failed", { name });
  }
}
