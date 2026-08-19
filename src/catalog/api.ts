import { createServer, type Server } from "node:http";
import { getCapability, listCapabilities, toolDefinition } from "./store.js";

export interface CatalogApiOptions {
  port?: number;
  invoke: (name: string, args: Record<string, string>) => Promise<unknown>;
}

export async function startCatalogApi(
  options: CatalogApiOptions,
): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const port = options.port ?? 3460;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    try {
      if (req.method === "GET" && url.pathname === "/capabilities") {
        const items = listCapabilities().map((cap) => ({
          name: cap.metadata.name,
          title: cap.metadata.title,
          status: cap.metadata.status,
          tool: toolDefinition(cap),
        }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ capabilities: items }, null, 2));
        return;
      }
      const invoke = url.pathname.match(/^\/capabilities\/([^/]+)\/invoke$/);
      if (req.method === "POST" && invoke) {
        const name = decodeURIComponent(invoke[1] ?? "");
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
          arguments?: Record<string, string>;
        };
        const result = await options.invoke(name, body.arguments ?? {});
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      const getOne = url.pathname.match(/^\/capabilities\/([^/]+)$/);
      if (req.method === "GET" && getOne) {
        const cap = getCapability(decodeURIComponent(getOne[1] ?? ""));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ capability: cap, tool: toolDefinition(cap) }, null, 2));
        return;
      }
      res.writeHead(404).end("not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
