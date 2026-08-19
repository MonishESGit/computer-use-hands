import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/heritage-core/app.js";
import { LiveSession } from "../../src/session/live.js";

interface Running {
  base: string;
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
  return { base: `http://127.0.0.1:${address.port}`, server };
}

describe("Playwright surface against Heritage Core", () => {
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

  it("fills User ID by accessibility name on the login screen", async () => {
    const inst = await listen();
    running.push(inst);
    const session = await LiveSession.launch();
    sessions.push(session);
    await session.driver.act({ type: "navigate", url: `${inst.base}/t/first-federal/login` });
    const result = await session.driver.act({
      type: "fill",
      value: "teller",
      target: {
        description: "User ID",
        locators: [{ strategy: "ax_role_name", role: "textbox", name: "User ID", confidence: 0.95 }],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.recordedLocators[0]?.strategy).toBe("ax_role_name");
    const obs = await session.driver.observe();
    expect(obs.combinedText).toContain("Teller Sign-On");
  }, 45_000);
});
