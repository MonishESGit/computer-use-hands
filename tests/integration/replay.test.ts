import http from "node:http";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/heritage-core/app.js";
import { loadCapabilityFile } from "../../src/artifact/io.js";
import { polishCapability } from "../../src/artifact/polish.js";
import { ScriptedClient } from "../../src/agent/scripted.js";
import { RunLog } from "../../src/evidence/run.js";
import { loadPolicyFile } from "../../src/policy/load.js";
import { replay } from "../../src/replay/engine.js";
import { LiveSession } from "../../src/session/live.js";
import type { Capability } from "../../src/artifact/schema.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const capability = loadCapabilityFile(
  path.join(root, "capabilities/lookup_member_savings_balance.json"),
);
const openProduct = loadCapabilityFile(path.join(root, "capabilities/open_auxiliary_share.json"));
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

  async function run(tenant: string, memberId: string, cap: Capability = capability, extras: { assist?: ScriptedClient } = {}) {
    const inst = await listen();
    running.push(inst);
    const session = await LiveSession.launch();
    sessions.push(session);
    const evidence = new RunLog({
      root: path.join(root, ".hands-cache", "replay-tests"),
      policy,
    });
    return replay({
      capability: cap,
      params: { tenant, memberId, port: inst.port },
      secrets: { teller_user: "teller", teller_password: "teller" },
      policy,
      session,
      evidence,
      assist: extras.assist,
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
      const shots = readdirSync(path.join(result.evidenceDir, "screenshots"));
      expect(shots.some((name) => name.includes("MEMBER_NOT_FOUND"))).toBe(true);
    }
  }, 60_000);

  it("reports VALIDATION_ERROR for a malformed identifier", async () => {
    const result = await run("first-federal", "12");
    expect(result.status).toBe("business_outcome");
    if (result.status === "business_outcome") {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  }, 60_000);

  it("escalates session expiry instead of treating it as a crash", async () => {
    const result = await run("first-federal", "00000");
    expect(result.status).toBe("escalated");
    if (result.status === "escalated") {
      expect(result.reason).toMatch(/session expired/i);
      expect(existsSync(path.join(result.evidenceDir, "screenshots", "escalated.png"))).toBe(true);
    }
  }, 60_000);

  it("reports PERMISSION_DENIED when the teller cannot open a product", async () => {
    const result = await run("first-federal", "67890", openProduct);
    expect(result.status).toBe("business_outcome");
    if (result.status === "business_outcome") {
      expect(result.code).toBe("PERMISSION_DENIED");
    }
  }, 60_000);

  it("replays the polished live-discovery artifact without a handwritten rewrite", async () => {
    const polished = polishCapability(
      loadCapabilityFile(path.join(root, "evidence/runs/discovery-llm-success/artifact.json")),
    );
    const result = await run("first-federal", "12345", polished);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.outputs.memberName).toBe("Alicia Nguyen");
      expect(result.outputs.savingsBalance).toBe(4250.18);
    }
  }, 60_000);

  it("repairs one broken locator with a bounded assist step", async () => {
    const broken = structuredClone(capability);
    const search = broken.spec.steps.find((step) => step.target?.description === "Search");
    if (!search?.target) {
      throw new Error("expected Search step");
    }
    search.target.locators = [{ strategy: "css", css: "#does-not-exist", confidence: 0.99 }];
    const result = await run("first-federal", "12345", broken, {
      assist: new ScriptedClient([
        {
          thought: "Search is still a button in the main frame",
          status: "continue",
          action: { type: "click", role: "button", name: "Search", frame: "main" },
        },
      ]),
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.outputs.memberName).toBe("Alicia Nguyen");
    }
  }, 60_000);
});
