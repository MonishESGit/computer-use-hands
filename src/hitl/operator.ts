import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveSession } from "../session/live.js";
import type { Observation } from "../surface/types.js";

export interface InterventionRequest {
  id: string;
  runId: string;
  goal?: string;
  capabilityName?: string;
  stepId?: string;
  reason: string;
  createdAt: string;
}

export interface OperatorHandle {
  port: number;
  url: string;
  waitUntilSettled: () => Promise<"resume" | "abort" | "complete">;
  close: () => Promise<void>;
}

export async function startOperator(options: {
  session: LiveSession;
  intervention: InterventionRequest;
  observation: Observation;
  port?: number;
}): Promise<OperatorHandle> {
  const requested = options.port ?? Number(process.env.HANDS_OPERATOR_PORT ?? 3450);
  let bound = requested;
  let decision: "resume" | "abort" | "complete" | undefined;
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../apps/operator/public");

  const server: Server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${bound}`);
    try {
      if (req.method === "GET" && url.pathname === "/") {
        const html = readFileSync(path.join(publicDir, "index.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/state") {
        const live = await options.session.driver.observe().catch(() => options.observation);
        json(res, {
          intervention: options.intervention,
          owner: options.session.control.owner,
          observation: {
            url: live.url,
            signatures: live.signatures,
            text: live.combinedText.slice(0, 2000),
          },
          humanLog: options.session.humanLog,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/screenshot") {
        const shot = await options.session.driver.screenshot();
        res.writeHead(200, { "content-type": "image/png" });
        res.end(shot);
        return;
      }
      if (req.method === "POST" && url.pathname === "/resume") {
        const body = await readJson(req);
        decision = body.decision === "abort" || body.decision === "complete" ? body.decision : "resume";
        options.session.resume();
        json(res, { ok: true, decision });
        return;
      }
      if (req.method === "POST" && url.pathname === "/inject") {
        options.session.pauseForHuman();
        const body = await readJson(req);
        const type = (body.type as "click" | "fill" | "dismiss_dialog") ?? "click";
        await options.session.driver.act({
          type,
          value: body.value,
          target:
            type === "dismiss_dialog"
              ? undefined
              : {
                  description: body.name ?? "injected",
                  locators: [
                    {
                      strategy: "ax_role_name",
                      role: body.role ?? "button",
                      name: body.name ?? "OK",
                      frame: body.frame ? [body.frame] : undefined,
                      confidence: 0.9,
                    },
                  ],
                },
        });
        options.session.humanLog.push({
          at: new Date().toISOString(),
          type: type === "fill" ? "fill" : type === "dismiss_dialog" ? "click" : "click",
          detail: body.name ? `${type} ${body.name}` : type,
        });
        json(res, { ok: true, humanLog: options.session.humanLog });
        return;
      }
      res.writeHead(404).end("not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(requested, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("operator failed to bind");
  }
  bound = address.port;

  return {
    port: bound,
    url: `http://127.0.0.1:${bound}`,
    waitUntilSettled: () =>
      new Promise((resolve) => {
        const timer = setInterval(() => {
          if (decision) {
            clearInterval(timer);
            resolve(decision);
          }
        }, 100);
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as Record<string, string>;
}
