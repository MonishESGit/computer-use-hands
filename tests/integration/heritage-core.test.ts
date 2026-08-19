import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/heritage-core/app.js";

interface Running {
  base: string;
  server: http.Server;
}

async function listen(idleMs = 60_000): Promise<Running> {
  const { app } = createApp({ idleMs });
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

async function close(running: Running): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    running.server.close((err) => (err ? reject(err) : resolve()));
  });
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie");
  if (!raw) {
    throw new Error("missing set-cookie");
  }
  const sid = raw.split(";")[0];
  if (!sid) {
    throw new Error("empty set-cookie");
  }
  return sid;
}

async function signOn(base: string, tenant: string): Promise<string> {
  const res = await fetch(`${base}/t/${tenant}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "uid=teller&pwd=teller",
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  return cookieFrom(res);
}

async function post(
  base: string,
  path: string,
  cookie: string,
  body: string,
): Promise<string> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
  });
  if (res.status === 303) {
    const loc = res.headers.get("location");
    if (!loc) {
      throw new Error("redirect without location");
    }
    const follow = await fetch(`${base}${loc}`, { headers: { cookie } });
    return follow.text();
  }
  return res.text();
}

describe("Heritage Core stand-in", () => {
  const running: Running[] = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map(close));
  });

  async function start(idleMs?: number): Promise<Running> {
    const inst = await listen(idleMs);
    running.push(inst);
    return inst;
  }

  it("serves a health check and both tenant sign-on pages", async () => {
    const { base } = await start();
    const health = await fetch(`${base}/healthz`);
    expect(await health.text()).toBe("ok");

    const ff = await (await fetch(`${base}/t/first-federal/login`)).text();
    expect(ff).toContain("First Federal Credit Union");
    expect(ff).toContain("title=\"User ID\"");

    const rv = await (await fetch(`${base}/t/riverside/login`)).text();
    expect(rv).toContain("Riverside Community Bank");
    expect(rv).not.toContain("data-testid");
  });

  it("rejects unknown institutions and bad passwords", async () => {
    const { base } = await start();
    const missing = await fetch(`${base}/t/not-a-bank/login`);
    expect(missing.status).toBe(404);

    const denied = await fetch(`${base}/t/first-federal/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "uid=teller&pwd=wrong",
    });
    expect(await denied.text()).toContain("Sign-on failed");
  });

  it("looks up member 12345 after dismissing the maintenance notice", async () => {
    const { base } = await start();
    const cookie = await signOn(base, "first-federal");
    const home = await (await fetch(`${base}/t/first-federal/main/home`, { headers: { cookie } })).text();
    expect(home).toContain("System Notice");
    expect(home).toContain("value=\"OK\"");

    await post(base, "/t/first-federal/main/notice", cookie, "next=inquiry");
    const inquiry = await (
      await fetch(`${base}/t/first-federal/main/inquiry`, { headers: { cookie } })
    ).text();
    expect(inquiry).toContain("Member Number");
    expect(inquiry).toContain("value=\"Search\"");

    const result = await post(base, "/t/first-federal/main/inquiry", cookie, "mid=12345");
    expect(result).toContain("Alicia Nguyen");
    expect(result).toContain("Share Balance");
    expect(result).toContain("$4,250.18");
  });

  it("uses Riverside labels for the same member record", async () => {
    const { base } = await start();
    const cookie = await signOn(base, "riverside");
    await post(base, "/t/riverside/main/notice", cookie, "next=inquiry");
    const result = await post(base, "/t/riverside/main/inquiry", cookie, "mid=12345");
    expect(result).toContain("Customer No.");
    expect(result).toContain("Current Savings");
    expect(result).toContain("Alicia Nguyen");
    expect(result).toContain("$4,250.18");
  });

  it("classifies validation, not-found, and session-expired inquiry outcomes", async () => {
    const { base } = await start();
    const cookie = await signOn(base, "first-federal");
    await post(base, "/t/first-federal/main/notice", cookie, "next=inquiry");

    const invalid = await post(base, "/t/first-federal/main/inquiry", cookie, "mid=12");
    expect(invalid).toContain("Validation error");
    expect(invalid).toContain("5-digit");

    const missing = await post(base, "/t/first-federal/main/inquiry", cookie, "mid=99999");
    expect(missing).toContain("Record not found");
    expect(missing).toContain("99999");

    const expired = await post(base, "/t/first-federal/main/inquiry", cookie, "mid=00000");
    expect(expired).toContain("Session expired — please log in");

    const after = await fetch(`${base}/t/first-federal/main/inquiry`, { headers: { cookie } });
    expect(await after.text()).toContain("Session expired");
  });

  it("denies opening a product for a restricted member and posts for an eligible one", async () => {
    const { base } = await start();
    const cookie = await signOn(base, "riverside");
    await post(base, "/t/riverside/main/notice", cookie, "next=open");

    const denied = await post(base, "/t/riverside/main/open", cookie, "mid=67890&ptype=savings");
    expect(denied).toContain("Permission denied");

    const confirm = await post(base, "/t/riverside/main/open", cookie, "mid=12345&ptype=savings");
    expect(confirm).toContain("Confirmation required");
    expect(confirm).toContain("Confirm Opening");
    expect(confirm).toContain("not reversible");

    const receipt = await post(
      base,
      "/t/riverside/main/open/confirm",
      cookie,
      "mid=12345&ptype=savings",
    );
    expect(receipt).toContain("New Sub-Account ID");
    expect(receipt).toContain("SH-12345-");
    expect(receipt).toContain("Accepted");
  });

  it("expires an idle teller session", async () => {
    const { base } = await start(40);
    const cookie = await signOn(base, "first-federal");
    await new Promise((resolve) => setTimeout(resolve, 60));
    const page = await (await fetch(`${base}/t/first-federal/main/home`, { headers: { cookie } })).text();
    expect(page).toContain("Session expired — please log in");
  });
});
