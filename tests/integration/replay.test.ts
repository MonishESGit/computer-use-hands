import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/heritage-core/app.js";
import { loadCapabilityFile } from "../../src/artifact/io.js";
import { RunLog } from "../../src/evidence/run.js";
import { loadPolicyFile } from "../../src/policy/load.js";
import { replay } from "../../src/replay/engine.js";
import { LiveSession } from "../../src/session/live.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const capability = loadCapabilityFile(
  path.join(root, "capabilities/lookup_member_savings_balance.json"),
);
const policy = loadPolicyFile(path.join(root, "policies/heritage-core.yaml"));

interface Running {
  base: string;
  port: number;
  server: http.Server;
}

async function listen(): Promise<Running> {
  const { app } = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return { base: `http://127.0.0.1:${address.port}`, port: address.port, server };
}

describe("deterministic replay", () => {
  const running: Running[] = [];
  const sessions: LiveSession[] = [];

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((s) => s.dispose()));
    await Promise.all(
      running.splice(0).map(
        (r) =>
          new Promise<void>((resolve, reject) => {
            r.server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  async function run(tenant: string, memberId: string) {
    const inst = await listen();
    running.push(inst);
    const session = await LiveSession.launch();
    sessions.push(session);
    const evidence = new RunLog({
      root: path.join(root, ".hands-cache", "replay-tests"),
      policy,
    });
    return replay({
      capability,
      params: { tenant, memberId, port: inst.port },
      secrets: { teller_user: "teller", teller_password: "teller" },
      policy,
      session,
      evidence,
    });
  }

  it("returns typed outputs for member 12345 on First Federal", async () => {
    const result = await run("first-federal", "12345");
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.outputs.memberName).toBe("Alicia Nguyen");
      expect(result.outputs.savingsBalance).toBe(4250.18);
    }
  }, 60_000);

  it("replays the same canonical artifact on Riverside labels", async () => {
    const result = await run("riverside", "12345");
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.outputs.memberName).toBe("Alicia Nguyen");
      expect(result.outputs.savingsBalance).toBe(4250.18);
    }
  }, 60_000);

  it("reports MEMBER_NOT_FOUND as a business outcome, not a crash", async () => {
    const result = await run("first-federal", "99999");
    expect(result.status).toBe("business_outcome");
    if (result.status === "business_outcome") {
      expect(result.code).toBe("MEMBER_NOT_FOUND");
    }
  }, 60_000);

  it("reports VALIDATION_ERROR for a malformed identifier", async () => {
    const result = await run("first-federal", "12");
    expect(result.status).toBe("business_outcome");
    if (result.status === "business_outcome") {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  }, 60_000);
});
