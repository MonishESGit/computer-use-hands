export {
  API_VERSION,
  CapabilitySchema,
  RunResultSchema,
  type Capability,
  type RunResult,
  type Locator,
  type Target,
  type Step,
  type ErrorClass,
  type ExceptionHandler,
  type Parameter,
} from "./schema.js";
export { parseCapability, parseCapabilityJson, loadCapabilityFile, serializeCapability, writeCapabilityFile } from "./io.js";
export { interpolate, resolveParameters, resolveValueFrom, ParameterError } from "./parameters.js";
export { namePatternFor, canonicalizeLocatorName, matchesAccessibleName } from "./canonicalize.js";
