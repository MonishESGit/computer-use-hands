import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/heritage-core/app.js";
import { discover } from "../../src/agent/loop.js";
import { ScriptedClient, heritageLookupScript } from "../../src/agent/scripted.js";
import { RunLog } from "../../src/evidence/run.js";
import { startOperator } from "../../src/hitl/operator.js";
import { loadPolicyFile } from "../../src/policy/load.js";
import { LiveSession } from "../../src/session/live.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function listen() {
  const { app } = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP");
  return { server, port: address.port, base: `http://127.0.0.1:${address.port}` };
}

describe("discovery loop (scripted LLM)", () => {
  const servers: http.Server[] = [];
  const sessions: LiveSession[] = [];

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((s) => s.dispose()));
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  it("completes the inquiry goal and compiles a draft capability", async () => {
    const inst = await listen();
    servers.push(inst.server);
    const session = await LiveSession.launch();
    sessions.push(session);
    const policy = loadPolicyFile(path.join(root, "policies/heritage-core.yaml"));
    const evidence = new RunLog({ root: path.join(root, ".hands-cache", "discover-tests"), policy });
    const result = await discover({
      goal: "Look up member 12345 and read the savings balance",
      entryUrl: `${inst.base}/t/first-federal/login`,
      tenant: "first-federal",
      session,
      llm: new ScriptedClient(heritageLookupScript(`${inst.base}/t/first-federal`, "12345")),
      policy,
      evidence,
      secrets: { teller_user: "teller", teller_password: "teller" },
    });
    expect(result.status).toBe("success");
    expect(result.capability?.metadata.status).toBe("draft");
    expect(result.capability?.spec.steps.some((s) => s.action === "fill")).toBe(true);
  }, 60_000);
});

describe("human handoff", () => {
  const servers: http.Server[] = [];
  const sessions: LiveSession[] = [];

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((s) => s.dispose()));
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  it("pauses the live session, injects a click, and resumes", async () => {
    const inst = await listen();
    servers.push(inst.server);
    const session = await LiveSession.launch();
    sessions.push(session);
    await session.driver.act({ type: "navigate", url: `${inst.base}/t/first-federal/login` });
    session.pauseForHuman();
    const obs = await session.driver.observe();
    const op = await startOperator({
      session,
      observation: obs,
      port: 0,
      intervention: {
        id: "int_test",
        runId: "run_test",
        reason: "stuck on sign-on",
        createdAt: new Date().toISOString(),
      },
    });
    const state = await (await fetch(`${op.url}/state`)).json();
    expect(state.owner).toBe("human");
    expect(state.intervention.reason).toContain("stuck");
    await fetch(`${op.url}/inject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "fill", role: "textbox", name: "User ID", value: "teller" }),
    });
    await fetch(`${op.url}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "resume" }),
    });
    expect(session.control.owner).toBe("automation");
    await op.close();
  }, 45_000);
});
