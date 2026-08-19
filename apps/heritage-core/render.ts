import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const viewsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "views");

const ALLOWED_VIEWS = new Set([
  "login.html",
  "frameset.html",
  "header.html",
  "dashboard.html",
  "inquiry.html",
  "inquiry-result.html",
  "host-message.html",
  "interstitial.html",
  "session-expired.html",
  "open-form.html",
  "open-confirm.html",
  "open-receipt.html",
  "index.html",
]);

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function render(view: string, vars: Record<string, string>): string {
  if (!ALLOWED_VIEWS.has(view)) {
    throw new Error(`Unknown view: ${view}`);
  }
  const raw = fs.readFileSync(path.join(viewsDir, view), "utf8");
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}
