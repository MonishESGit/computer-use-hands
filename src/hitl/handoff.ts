import { randomUUID } from "node:crypto";
import type { RunLog } from "../evidence/run.js";
import type { LiveSession } from "../session/live.js";
import { startOperator, type OperatorHandle } from "./operator.js";

export async function handoffToOperator(options: {
  session: LiveSession;
  evidence: RunLog;
  reason: string;
  goal?: string;
  capabilityName?: string;
  stepId?: string;
  wait: boolean;
  onUrl?: (url: string) => void;
}): Promise<"resume" | "abort" | "complete"> {
  options.session.pauseForHuman();
  const observation = await options.session.driver.observe();
  const intervention = {
    id: `int_${randomUUID()}`,
    runId: options.evidence.runId,
    reason: options.reason,
    createdAt: new Date().toISOString(),
    ...(options.goal ? { goal: options.goal } : {}),
    ...(options.capabilityName ? { capabilityName: options.capabilityName } : {}),
    ...(options.stepId ? { stepId: options.stepId } : {}),
  };
  options.evidence.writeJson("intervention.json", intervention);
  let operator: OperatorHandle | undefined;
  try {
    operator = await startOperator({
      session: options.session,
      observation,
      intervention,
    });
    options.onUrl?.(operator.url);
    if (!options.wait) {
      return "abort";
    }
    return await operator.waitUntilSettled();
  } finally {
    await operator?.close().catch(() => undefined);
  }
}
