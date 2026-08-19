import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RunResult } from "../artifact/schema.js";
import type { Policy } from "../policy/enforce.js";
import { redactRecord, redactText } from "../policy/redact.js";

export interface EvidenceEvent {
  at: string;
  kind: string;
  payload: unknown;
}

export class RunLog {
  readonly runId: string;
  readonly dir: string;
  private readonly policy: Policy | undefined;

  constructor(options: { runId?: string; root?: string; policy?: Policy } = {}) {
    this.runId = options.runId ?? `run_${randomUUID()}`;
    this.dir = path.join(options.root ?? path.join("evidence", "runs"), this.runId);
    this.policy = options.policy;
    mkdirSync(path.join(this.dir, "screenshots"), { recursive: true });
  }

  event(kind: string, payload: unknown): void {
    const safe = this.policy ? redactRecord(payload, this.policy) : payload;
    const line = JSON.stringify({ at: new Date().toISOString(), kind, payload: safe }) + "\n";
    appendFileSync(path.join(this.dir, "events.jsonl"), line, "utf8");
  }

  writeJson(name: string, value: unknown): void {
    const safe = this.policy ? redactRecord(value, this.policy) : value;
    writeFileSync(path.join(this.dir, name), `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  }

  screenshot(name: string, buffer: Buffer): string {
    const file = path.join(this.dir, "screenshots", name);
    writeFileSync(file, buffer);
    return file;
  }

  note(text: string): void {
    const safe = this.policy ? redactText(text, this.policy) : text;
    this.event("note", { text: safe });
  }

  finish(result: RunResult): void {
    this.writeJson("run.json", { finishedAt: new Date().toISOString(), result });
  }
}
