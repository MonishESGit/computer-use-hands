import type { Checkpoint } from "../artifact/schema.js";
import type { Observation } from "../surface/types.js";

export function checkpointHolds(obs: Observation, checkpoint: Checkpoint): boolean {
  const scoped = checkpoint.frame?.length
    ? obs.frames.filter((frame) => checkpoint.frame!.includes(frame.name))
    : obs.frames;
  const text = scoped.map((frame) => frame.text).join("\n");
  const ax = scoped.map((frame) => frame.ariaSnapshot).join("\n");
  switch (checkpoint.kind) {
    case "url_includes":
      return obs.url.includes(checkpoint.value) || scoped.some((frame) => frame.url.includes(checkpoint.value));
    case "text_includes":
      return text.includes(checkpoint.value) || obs.combinedText.includes(checkpoint.value);
    case "ax_contains":
      return ax.includes(checkpoint.value);
    case "role_name_present":
      return ax.includes(checkpoint.value) || text.includes(checkpoint.value);
    default: {
      const _never: never = checkpoint.kind;
      return _never;
    }
  }
}

export function parseExtracted(text: string, parse: "text" | "currency" | "integer"): string | number {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (parse === "text") {
    return trimmed;
  }
  if (parse === "integer") {
    const n = Number.parseInt(trimmed.replace(/[^\d-]/g, ""), 10);
    if (!Number.isFinite(n)) {
      throw new Error(`not an integer: ${trimmed}`);
    }
    return n;
  }
  const match = trimmed.match(/\$?([\d,]+(?:\.\d{2})?)/);
  if (!match?.[1]) {
    throw new Error(`not a currency value: ${trimmed}`);
  }
  return Number(match[1].replace(/,/g, ""));
}
