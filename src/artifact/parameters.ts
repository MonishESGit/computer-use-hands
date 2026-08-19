import type { Capability, Parameter, ValueFrom } from "./schema.js";

export type ParamValues = Record<string, string | number>;

export class ParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParameterError";
  }
}

export function interpolate(template: string, values: ParamValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new ParameterError(`missing template parameter ${name}`);
    }
    return String(value);
  });
}

export function resolveParameters(
  capability: Capability,
  provided: ParamValues,
  extras: ParamValues = {},
): ParamValues {
  const resolved: ParamValues = { ...extras };
  for (const param of capability.spec.parameters) {
    const raw = provided[param.name] ?? param.default;
    if (raw === undefined) {
      if (param.required) {
        throw new ParameterError(`missing required parameter ${param.name}`);
      }
      continue;
    }
    resolved[param.name] = coerce(param, raw);
  }
  return resolved;
}

export function resolveValueFrom(
  valueFrom: ValueFrom,
  params: ParamValues,
  secrets: Record<string, string>,
): string {
  switch (valueFrom.kind) {
    case "literal":
      return valueFrom.value;
    case "parameter": {
      const value = params[valueFrom.name];
      if (value === undefined) {
        throw new ParameterError(`parameter ${valueFrom.name} is not bound`);
      }
      return String(value);
    }
    case "secret": {
      const value = secrets[valueFrom.ref];
      if (value === undefined) {
        throw new ParameterError(`secret ${valueFrom.ref} is not bound`);
      }
      return value;
    }
    default: {
      const _never: never = valueFrom;
      return _never;
    }
  }
}

function coerce(param: Parameter, raw: string | number): string | number {
  if (param.type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      throw new ParameterError(`parameter ${param.name} must be a number`);
    }
    return n;
  }
  const text = String(raw);
  if (param.type === "enum") {
    if (!param.enumValues?.includes(text)) {
      throw new ParameterError(
        `parameter ${param.name} must be one of ${param.enumValues?.join(", ")}`,
      );
    }
  }
  return text;
}
