import { randomInt } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { formatUsd, isTenantId, loadMembers, loadTenant } from "./data.js";
import { escapeHtml, render } from "./render.js";
import { createMemorySessions, type SessionStore, type TellerSession } from "./sessions.js";
import type { MemberRecord, TenantConfig, TenantId } from "./types.js";

const COOKIE = "hc.sid";
const MEMBER_ID_RE = /^\d{5}$/;

export interface HeritageCoreOptions {
  idleMs?: number;
  tellerUser?: string;
  tellerPassword?: string;
  sessions?: SessionStore;
}

export interface HeritageCoreApp {
  app: Express;
  sessions: SessionStore;
}

export function createApp(options: HeritageCoreOptions = {}): HeritageCoreApp {
  const idleMs = options.idleMs ?? Number(process.env.HC_IDLE_MS ?? 120_000);
  const tellerUser = options.tellerUser ?? process.env.HANDS_TELLER_USER ?? "teller";
  const tellerPassword = options.tellerPassword ?? process.env.HANDS_TELLER_PASSWORD ?? "teller";
  const sessions = options.sessions ?? createMemorySessions();
  const members = loadMembers();
  const app = express();

  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.get("/", (_req, res) => {
    html(res, render("index.html", {}));
  });

  app.param("tenant", (req, res, next, value) => {
    if (!isTenantId(String(value))) {
      res.status(404).type("text/plain").send("Unknown institution");
      return;
    }
    next();
  });

  app.get("/t/:tenant/login", (req, res) => {
    const tenant = tenantOf(req);
    html(res, loginPage(tenant, ""));
  });

  app.post("/t/:tenant/login", (req, res) => {
    const tenant = tenantOf(req);
    const uid = String(req.body?.uid ?? "");
    const pwd = String(req.body?.pwd ?? "");
    if (uid !== tellerUser || pwd !== tellerPassword) {
      html(res, loginPage(tenant, "Sign-on failed. Check User ID and Password."));
      return;
    }
    const session = sessions.create(tenant.id, uid);
    res.setHeader("Set-Cookie", cookie(session.id));
    res.redirect(303, `/t/${tenant.id}/app`);
  });

  app.get("/t/:tenant/logout", (req, res) => {
    const sid = readCookie(req.headers);
    if (sid) {
      sessions.destroy(sid);
    }
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.redirect(303, `/t/${tenantOf(req).id}/login`);
  });

  app.get("/t/:tenant/app", (req, res) => {
    const tenant = tenantOf(req);
    const session = requireTopSession(req, res, tenant, sessions, idleMs);
    if (!session) {
      return;
    }
    html(
      res,
      render("frameset.html", {
        institution: escapeHtml(tenant.name),
        headerSrc: `/t/${tenant.id}/header`,
        mainSrc: `/t/${tenant.id}/main/home`,
      }),
    );
  });

  app.get("/t/:tenant/header", (req, res) => {
    const tenant = tenantOf(req);
    const session = requireFrameSession(req, res, tenant, sessions, idleMs);
    if (!session) {
      return;
    }
    html(
      res,
      render("header.html", {
        institution: escapeHtml(tenant.name),
        primary: tenant.theme.primary,
        accent: tenant.theme.accent,
        teller: escapeHtml(session.user),
        sessionShort: escapeHtml(session.id.slice(0, 8)),
        homeLabel: escapeHtml(tenant.labels.home),
        inquiryLabel: escapeHtml(tenant.labels.inquiry),
        openLabel: escapeHtml(tenant.labels.openProduct),
        homeHref: `/t/${tenant.id}/main/home`,
        inquiryHref: `/t/${tenant.id}/main/inquiry`,
        openHref: `/t/${tenant.id}/main/open`,
        logoutHref: `/t/${tenant.id}/logout`,
      }),
    );
  });

  app.get("/t/:tenant/main/home", (req, res) => {
    const ctx = requireMain(req, res, sessions, idleMs);
    if (!ctx) {
      return;
    }
    if (maybeInterstitial(ctx, res, "home")) {
      return;
    }
    html(res, dashboardPage(ctx.tenant, ctx.session));
  });

  app.get("/t/:tenant/main/inquiry", (req, res) => {
    const ctx = requireMain(req, res, sessions, idleMs);
    if (!ctx) {
      return;
    }
    if (maybeInterstitial(ctx, res, "inquiry")) {
      return;
    }
    html(res, inquiryPage(ctx.tenant));
  });

  app.post("/t/:tenant/main/inquiry", async (req, res, next: NextFunction) => {
    try {
      const ctx = requireMain(req, res, sessions, idleMs);
      if (!ctx) {
        return;
      }
      const mid = String(req.body?.mid ?? "").trim();
      const result = await inquire(members, mid);
      html(res, inquiryOutcomePage(ctx.tenant, result, sessions, ctx.session));
    } catch (err) {
      next(err);
    }
  });

  app.get("/t/:tenant/main/open", (req, res) => {
    const ctx = requireMain(req, res, sessions, idleMs);
    if (!ctx) {
      return;
    }
    if (maybeInterstitial(ctx, res, "open")) {
      return;
    }
    html(res, openFormPage(ctx.tenant, ""));
  });

  app.post("/t/:tenant/main/open", (req, res) => {
    const ctx = requireMain(req, res, sessions, idleMs);
    if (!ctx) {
      return;
    }
    const mid = String(req.body?.mid ?? "").trim();
    const classified = classifyMemberId(mid);
    if (classified.kind !== "ok") {
      html(res, messagePage(ctx.tenant, classified.title, classified.body, "open"));
      return;
    }
    const member = members.find((row) => row.id === classified.id);
    if (!member) {
      html(
        res,
        messagePage(
          ctx.tenant,
          "Record not found",
          `No CIF record matches ${ctx.tenant.labels.memberId} ${classified.id}.`,
          "open",
        ),
      );
      return;
    }
    if (!member.canOpenProduct) {
      html(
        res,
        messagePage(
          ctx.tenant,
          "Permission denied",
          `Teller is not authorized to open a new product for this ${ctx.tenant.labels.memberId}.`,
          "open",
        ),
      );
      return;
    }
    ctx.session.openDraft = { memberId: member.id, memberName: member.name };
    sessions.save(ctx.session);
    html(
      res,
      render("open-confirm.html", {
        ...chrome(ctx.tenant),
        openLabel: escapeHtml(ctx.tenant.labels.openProduct),
        memberIdLabel: escapeHtml(ctx.tenant.labels.memberId),
        memberNameLabel: escapeHtml(ctx.tenant.labels.memberName),
        productTypeLabel: escapeHtml(ctx.tenant.labels.productType),
        confirmLabel: escapeHtml(ctx.tenant.labels.confirm),
        memberId: escapeHtml(member.id),
        memberName: escapeHtml(member.name),
        productType: "Savings",
        action: `/t/${ctx.tenant.id}/main/open/confirm`,
        cancelHref: `/t/${ctx.tenant.id}/main/open`,
      }),
    );
  });

  app.post("/t/:tenant/main/open/confirm", (req, res) => {
    const ctx = requireMain(req, res, sessions, idleMs);
    if (!ctx) {
      return;
    }
    const mid = String(req.body?.mid ?? "").trim();
    const draft = ctx.session.openDraft;
    if (!draft || draft.memberId !== mid) {
      html(
        res,
        messagePage(
          ctx.tenant,
          "Confirmation expired",
          "The pending product request is no longer on this session. Start again.",
          "open",
        ),
      );
      return;
    }
    const receiptId = `SH-${draft.memberId}-${randomInt(1000, 9999)}`;
    delete ctx.session.openDraft;
    sessions.save(ctx.session);
    html(
      res,
      render("open-receipt.html", {
        ...chrome(ctx.tenant),
        openLabel: escapeHtml(ctx.tenant.labels.openProduct),
        receiptIdLabel: escapeHtml(ctx.tenant.labels.receiptId),
        memberIdLabel: escapeHtml(ctx.tenant.labels.memberId),
        receiptId: escapeHtml(receiptId),
        memberId: escapeHtml(draft.memberId),
      }),
    );
  });

  app.post("/t/:tenant/main/notice", (req, res) => {
    const ctx = requireMain(req, res, sessions, idleMs);
    if (!ctx) {
      return;
    }
    ctx.session.seenInterstitial = true;
    sessions.save(ctx.session);
    const next = String(req.body?.next ?? "home");
    const allowed = new Set(["home", "inquiry", "open"]);
    const dest = allowed.has(next) ? next : "home";
    res.redirect(303, `/t/${ctx.tenant.id}/main/${dest}`);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).type("text/plain").send("Core host error");
  });

  return { app, sessions };
}

function tenantOf(req: Request): TenantConfig {
  const id = String(req.params.tenant);
  if (!isTenantId(id)) {
    throw new Error("tenant param should have been rejected");
  }
  return loadTenant(id);
}

function chrome(tenant: TenantConfig): Record<string, string> {
  return {
    institution: escapeHtml(tenant.name),
    primary: tenant.theme.primary,
    accent: tenant.theme.accent,
    bg: tenant.theme.bg,
    inquiryLabel: escapeHtml(tenant.labels.inquiry),
  };
}

function loginPage(tenant: TenantConfig, error: string): string {
  return render("login.html", {
    ...chrome(tenant),
    error: escapeHtml(error),
    action: `/t/${tenant.id}/login`,
  });
}

function dashboardPage(tenant: TenantConfig, session: TellerSession): string {
  return render("dashboard.html", {
    ...chrome(tenant),
    teller: escapeHtml(session.user),
    inquiryLabel: escapeHtml(tenant.labels.inquiry),
    openLabel: escapeHtml(tenant.labels.openProduct),
  });
}

function inquiryPage(tenant: TenantConfig): string {
  return render("inquiry.html", {
    ...chrome(tenant),
    memberIdLabel: escapeHtml(tenant.labels.memberId),
    action: `/t/${tenant.id}/main/inquiry`,
  });
}

function openFormPage(tenant: TenantConfig, error: string): string {
  return render("open-form.html", {
    ...chrome(tenant),
    openLabel: escapeHtml(tenant.labels.openProduct),
    memberIdLabel: escapeHtml(tenant.labels.memberId),
    productTypeLabel: escapeHtml(tenant.labels.productType),
    error: escapeHtml(error),
    action: `/t/${tenant.id}/main/open`,
  });
}

function messagePage(tenant: TenantConfig, title: string, body: string, again: "inquiry" | "open"): string {
  return render("host-message.html", {
    ...chrome(tenant),
    inquiryLabel: escapeHtml(again === "open" ? tenant.labels.openProduct : tenant.labels.inquiry),
    bannerTitle: escapeHtml(title),
    bannerBody: escapeHtml(body),
    againHref: `/t/${tenant.id}/main/${again}`,
  });
}

type InquiryResult =
  | { kind: "expired" }
  | { kind: "validation"; body: string }
  | { kind: "not_found"; id: string }
  | { kind: "ok"; member: MemberRecord };

function classifyMemberId(mid: string): { kind: "ok"; id: string } | { kind: "validation"; title: string; body: string } {
  if (!MEMBER_ID_RE.test(mid)) {
    return {
      kind: "validation",
      title: "Validation error",
      body: "Enter a 5-digit identifier. Other formats are rejected by the core.",
    };
  }
  return { kind: "ok", id: mid };
}

async function inquire(members: MemberRecord[], mid: string): Promise<InquiryResult> {
  if (mid === "00000") {
    return { kind: "expired" };
  }
  const classified = classifyMemberId(mid);
  if (classified.kind === "validation") {
    return { kind: "validation", body: classified.body };
  }
  const member = members.find((row) => row.id === classified.id);
  if (!member) {
    return { kind: "not_found", id: classified.id };
  }
  if (member.slowInquiryMs !== undefined) {
    await sleep(member.slowInquiryMs);
  }
  return { kind: "ok", member };
}

function inquiryOutcomePage(
  tenant: TenantConfig,
  result: InquiryResult,
  sessions: SessionStore,
  session: TellerSession,
): string {
  if (result.kind === "expired") {
    sessions.destroy(session.id);
    return render("session-expired.html", {
      ...chrome(tenant),
      loginHref: `/t/${tenant.id}/login`,
    });
  }
  if (result.kind === "validation") {
    return messagePage(tenant, "Validation error", result.body, "inquiry");
  }
  if (result.kind === "not_found") {
    return messagePage(
      tenant,
      "Record not found",
      `No CIF record matches ${tenant.labels.memberId} ${result.id}.`,
      "inquiry",
    );
  }
  return render("inquiry-result.html", {
    ...chrome(tenant),
    memberIdLabel: escapeHtml(tenant.labels.memberId),
    memberNameLabel: escapeHtml(tenant.labels.memberName),
    balanceLabel: escapeHtml(tenant.labels.balance),
    memberId: escapeHtml(result.member.id),
    memberName: escapeHtml(result.member.name),
    balance: escapeHtml(formatUsd(result.member.savingsBalance)),
    againHref: `/t/${tenant.id}/main/inquiry`,
  });
}

function maybeInterstitial(
  ctx: { tenant: TenantConfig; session: TellerSession },
  res: Response,
  next: "home" | "inquiry" | "open",
): boolean {
  if (ctx.session.seenInterstitial) {
    return false;
  }
  html(
    res,
    render("interstitial.html", {
      ...chrome(ctx.tenant),
      action: `/t/${ctx.tenant.id}/main/notice`,
      next,
    }),
  );
  return true;
}

function requireMain(
  req: Request,
  res: Response,
  sessions: SessionStore,
  idleMs: number,
): { tenant: TenantConfig; session: TellerSession } | undefined {
  const tenant = tenantOf(req);
  const session = requireFrameSession(req, res, tenant, sessions, idleMs);
  if (!session) {
    return undefined;
  }
  return { tenant, session };
}

function requireTopSession(
  req: Request,
  res: Response,
  tenant: TenantConfig,
  sessions: SessionStore,
  idleMs: number,
): TellerSession | undefined {
  const session = loadSession(req, tenant, sessions, idleMs);
  if (!session) {
    res.redirect(303, `/t/${tenant.id}/login`);
    return undefined;
  }
  return session;
}

function requireFrameSession(
  req: Request,
  res: Response,
  tenant: TenantConfig,
  sessions: SessionStore,
  idleMs: number,
): TellerSession | undefined {
  const session = loadSession(req, tenant, sessions, idleMs);
  if (!session) {
    html(
      res,
      render("session-expired.html", {
        ...chrome(tenant),
        loginHref: `/t/${tenant.id}/login`,
      }),
    );
    return undefined;
  }
  return session;
}

function loadSession(
  req: Request,
  tenant: TenantConfig,
  sessions: SessionStore,
  idleMs: number,
): TellerSession | undefined {
  const sid = readCookie(req.headers);
  if (!sid) {
    return undefined;
  }
  const session = sessions.touch(sid, idleMs);
  if (!session || session.tenant !== tenant.id) {
    return undefined;
  }
  return session;
}

function readCookie(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers.cookie;
  if (!raw) {
    return undefined;
  }
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) {
      return rest.join("=");
    }
  }
  return undefined;
}

function cookie(id: string): string {
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

function html(res: Response, body: string): void {
  res.status(200).type("html").send(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type { TenantId };
