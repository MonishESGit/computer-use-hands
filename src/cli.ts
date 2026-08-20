#!/usr/bin/env node

import path from "node:path";
import { loadCapabilityFile, writeCapabilityFile } from "./artifact/io.js";
import { polishCapability } from "./artifact/polish.js";
import { discover } from "./agent/loop.js";
import { OpenAiClient } from "./agent/openai.js";
import { ScriptedClient, heritageLookupScript } from "./agent/scripted.js";
import { startCatalogApi } from "./catalog/api.js";
import { approveCapability, getCapability, listCapabilities, toolDefinition } from "./catalog/store.js";
import { writePlaywrightSpec } from "./codegen/playwrightSpec.js";
import { RunLog } from "./evidence/run.js";
import { handoffToOperator } from "./hitl/handoff.js";
import { loadPolicyFile } from "./policy/load.js";
import { replay } from "./replay/engine.js";
import { defaultPolicyPath, loadDotEnv, tellerSecrets } from "./runtime/env.js";
import { LiveSession } from "./session/live.js";

loadDotEnv();

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "discover":
      await cmdDiscover(parseArgs(rest));
      return;
    case "replay":
      await cmdReplay(parseArgs(rest));
      return;
    case "invoke":
      await cmdInvoke(rest);
      return;
    case "catalog":
      cmdCatalog();
      return;
    case "approve":
      cmdApprove(rest[0]);
      return;
    case "polish":
      cmdPolish(parseArgs(rest));
      return;
    case "codegen":
      cmdCodegen(parseArgs(rest));
      return;
    case "stability":
      await cmdStability(parseArgs(rest));
      return;
    case "hitl-demo":
      await cmdHitlDemo(parseArgs(rest));
      return;
    case "serve":
      await cmdServe();
      return;
    default:
      usage();
  }
}

function usage(): void {
  process.stdout.write(`hands — computer-use runtime

  hands discover --goal "..." --tenant first-federal [--headed] [--scripted] [--hitl]
  hands replay --capability capabilities/lookup_member_savings_balance.json --param tenant=first-federal --param memberId=12345
  hands replay ... --param memberId=00000 --hitl [--headed]
  hands hitl-demo [--unattended]
  hands invoke lookup_member_savings_balance --memberId=12345 --tenant=riverside
  hands catalog
  hands approve lookup_member_savings_balance
  hands polish --capability evidence/runs/discovery-llm-success/artifact.json --out capabilities/lookup_member_savings_balance.json
  hands codegen --capability capabilities/lookup_member_savings_balance.json --out tests/generated
  hands stability --capability capabilities/lookup_member_savings_balance.json --n 3
  hands serve
`);
}

function parseArgs(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const params: string[] = [];
  const flags = new Set(["headed", "scripted", "hitl", "unattended", "assist"]);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token) continue;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (flags.has(key)) {
      out[key] = "true";
      continue;
    }
    const next = rest[i + 1];
    if (key === "param" && next) {
      params.push(next);
      i += 1;
      continue;
    }
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  out.params = params.join(",");
  return out;
}

function kvParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

function flag(args: Record<string, string>, name: string): boolean {
  return args[name] === "true";
}

async function cmdDiscover(args: Record<string, string>): Promise<void> {
  const tenant = args.tenant ?? "first-federal";
  const port = Number(process.env.HC_PORT ?? 3401);
  const goal =
    args.goal ??
    "Log in as the teller and look up member 12345. Read the current savings balance.";
  const entryUrl = `http://127.0.0.1:${port}/t/${tenant}/login`;
  const policy = loadPolicyFile(defaultPolicyPath());
  const evidence = new RunLog({ policy });
  const headed = flag(args, "headed") || (flag(args, "hitl") && !flag(args, "unattended"));
  const session = await LiveSession.launch({ headed });
  const llm =
    flag(args, "scripted") || !process.env.OPENAI_API_KEY
      ? new ScriptedClient(heritageLookupScript(`http://127.0.0.1:${port}/t/${tenant}`, "12345"))
      : new OpenAiClient(process.env.OPENAI_API_KEY);
  try {
    const result = await discover({
      goal,
      entryUrl,
      tenant,
      session,
      llm,
      policy,
      evidence,
      secrets: tellerSecrets(),
      onStuck:
        flag(args, "hitl") || headed
          ? async (reason) => {
              const decision = await handoffToOperator({
                session,
                evidence,
                reason,
                goal,
                wait: !flag(args, "unattended"),
                onUrl: (url) => process.stdout.write(`HITL operator ${url}\n`),
              });
              process.stdout.write(`HITL decision ${decision}\n`);
            }
          : undefined,
    });
    process.stdout.write(`${JSON.stringify({ status: result.status, reason: result.reason, run: evidence.dir }, null, 2)}\n`);
    if (result.capability) {
      const file = path.join("capabilities", `${result.capability.metadata.name}.discovered.json`);
      writeCapabilityFile(file, result.capability);
      process.stdout.write(`wrote ${file} (draft; review, then hands approve)\n`);
    }
  } finally {
    await session.dispose();
  }
}

async function cmdReplay(args: Record<string, string>): Promise<void> {
  if (!args.capability) {
    throw new Error("--capability is required");
  }
  const capability = loadCapabilityFile(args.capability);
  const policy = loadPolicyFile(defaultPolicyPath());
  const params = kvParams(args.params ?? "");
  const evidence = new RunLog({ policy });
  const headed = flag(args, "headed") || (flag(args, "hitl") && !flag(args, "unattended"));
  const session = await LiveSession.launch({ headed });
  try {
    const result = await replay({
      capability,
      params,
      secrets: tellerSecrets(),
      policy,
      session,
      evidence,
      assist: flag(args, "assist")
        ? process.env.OPENAI_API_KEY
          ? new OpenAiClient(process.env.OPENAI_API_KEY)
          : undefined
        : undefined,
      onEscalate: flag(args, "hitl")
        ? async (reason) => {
            const decision = await handoffToOperator({
              session,
              evidence,
              reason,
              capabilityName: capability.metadata.name,
              wait: !flag(args, "unattended"),
              onUrl: (url) => process.stdout.write(`HITL operator ${url}\nThe headed Chromium window is the same live session.\n`),
            });
            process.stdout.write(`HITL decision ${decision}\n`);
            return decision;
          }
        : undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await session.dispose();
  }
}

async function cmdHitlDemo(args: Record<string, string>): Promise<void> {
  const next: Record<string, string> = {
    ...args,
    capability: path.join("capabilities", "lookup_member_savings_balance.json"),
    params: `tenant=${args.tenant ?? "first-federal"},memberId=00000`,
    hitl: "true",
  };
  if (!flag(args, "unattended")) {
    next.headed = "true";
  }
  await cmdReplay(next);
}

async function cmdInvoke(rest: string[]): Promise<void> {
  const name = rest[0];
  if (!name) throw new Error("capability name required");
  const args: Record<string, string> = {};
  for (const token of rest.slice(1)) {
    const t = token.replace(/^--/, "");
    const eq = t.indexOf("=");
    if (eq > 0) args[t.slice(0, eq)] = t.slice(eq + 1);
  }
  await cmdReplay({
    capability: path.join("capabilities", `${name}.json`),
    params: Object.entries(args)
      .map(([k, v]) => `${k}=${v}`)
      .join(","),
  });
}

function cmdCatalog(): void {
  const items = listCapabilities().map((cap) => ({
    name: cap.metadata.name,
    status: cap.metadata.status,
    tool: toolDefinition(cap),
  }));
  process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
}

function cmdApprove(name: string | undefined): void {
  if (!name) throw new Error("capability name required");
  const cap = approveCapability(name.replace(/\.json$/, ""));
  process.stdout.write(`approved ${cap.metadata.name}\n`);
}

function cmdPolish(args: Record<string, string>): void {
  if (!args.capability) throw new Error("--capability is required");
  const polished = polishCapability(loadCapabilityFile(args.capability));
  const out = args.out ?? args.capability;
  writeCapabilityFile(out, polished);
  process.stdout.write(`wrote ${out} (${polished.spec.steps.length} steps)\n`);
}

function cmdCodegen(args: Record<string, string>): Promise<void> | void {
  if (!args.capability) throw new Error("--capability is required");
  const cap = loadCapabilityFile(args.capability);
  const file = writePlaywrightSpec(cap, args.out ?? "tests/generated");
  process.stdout.write(`wrote ${file}\n`);
}

async function cmdStability(args: Record<string, string>): Promise<void> {
  const n = Number(args.n ?? 3);
  for (let i = 0; i < n; i += 1) {
    await cmdReplay(args);
  }
  process.stdout.write(`stability ran ${n} replay(s)\n`);
}

async function cmdServe(): Promise<void> {
  const api = await startCatalogApi({
    invoke: async (name, args) => {
      const cap = getCapability(name);
      const policy = loadPolicyFile(defaultPolicyPath());
      const evidence = new RunLog({ policy });
      const session = await LiveSession.launch();
      try {
        return await replay({
          capability: cap,
          params: args,
          secrets: tellerSecrets(),
          policy,
          session,
          evidence,
        });
      } finally {
        await session.dispose();
      }
    },
  });
  process.stdout.write(`catalog API ${api.url}\nGET /capabilities\nPOST /capabilities/:name/invoke\n`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
