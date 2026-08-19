import type { ErrorClass } from "../artifact/schema.js";

interface SignatureRule {
  match: ErrorClass;
  re: RegExp;
}

const RULES: readonly SignatureRule[] = [
  { match: "session_expired", re: /session expired/i },
  { match: "permission_denied", re: /permission denied/i },
  { match: "not_found", re: /record not found/i },
  { match: "validation_error", re: /validation error/i },
  { match: "unexpected_dialog", re: /system notice|scheduled maintenance/i },
];

export function classifyText(text: string): ErrorClass[] {
  const hits: ErrorClass[] = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      hits.push(rule.match);
    }
  }
  return hits;
}
