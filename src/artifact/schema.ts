import { z } from "zod";

export const API_VERSION = "hands/v1" as const;

export const ErrorClassSchema = z.enum([
  "validation_error",
  "not_found",
  "permission_denied",
  "unexpected_dialog",
  "session_expired",
  "timeout",
  "transient_slow",
  "locator_miss",
  "ambiguous_target",
  "policy_violation",
  "unknown",
]);
export type ErrorClass = z.infer<typeof ErrorClassSchema>;

export const BusinessOutcomeCodeSchema = z.enum([
  "MEMBER_NOT_FOUND",
  "PERMISSION_DENIED",
  "VALIDATION_ERROR",
]);
export type BusinessOutcomeCode = z.infer<typeof BusinessOutcomeCodeSchema>;

export const LocatorStrategySchema = z.enum([
  "ax_role_name",
  "ax_role_value",
  "label",
  "visible_text",
  "placeholder",
  "structural_path",
  "css",
  "test_id",
]);
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;

export const LocatorSchema = z
  .object({
    strategy: LocatorStrategySchema,
    role: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    namePattern: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    frame: z.array(z.string().min(1)).optional(),
    nth: z.number().int().nonnegative().optional(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((loc, ctx) => {
    switch (loc.strategy) {
      case "ax_role_name":
        if (!loc.role || !(loc.name || loc.namePattern)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "ax_role_name requires role and name or namePattern",
          });
        }
        break;
      case "ax_role_value":
        if (!loc.role || !loc.text) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "ax_role_value requires role and text (the value)",
          });
        }
        break;
      case "label":
      case "visible_text":
      case "placeholder":
        if (!loc.text && !loc.name && !loc.namePattern) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${loc.strategy} requires text, name, or namePattern`,
          });
        }
        break;
      case "structural_path":
        if (!loc.path) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "structural_path requires path",
          });
        }
        break;
      case "css":
        if (!loc.css) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "css requires css",
          });
        }
        break;
      case "test_id":
        if (!loc.testId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "test_id requires testId",
          });
        }
        break;
      default:
        break;
    }
  });
export type Locator = z.infer<typeof LocatorSchema>;

export const TargetSchema = z.object({
  description: z.string().min(1),
  locators: z.array(LocatorSchema).min(1),
});
export type Target = z.infer<typeof TargetSchema>;

export const CheckpointSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["url_includes", "ax_contains", "text_includes", "role_name_present"]),
  value: z.string().min(1),
  frame: z.array(z.string().min(1)).optional(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const ValueFromSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string() }),
  z.object({ kind: z.literal("parameter"), name: z.string().min(1) }),
  z.object({ kind: z.literal("secret"), ref: z.string().min(1) }),
]);
export type ValueFrom = z.infer<typeof ValueFromSchema>;

export const ActionTypeSchema = z.enum([
  "navigate",
  "click",
  "fill",
  "select",
  "press",
  "wait_for",
  "extract",
  "dismiss_dialog",
  "switch_frame",
  "assert_checkpoint",
  "human_step",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const RiskClassSchema = z.enum(["safe", "reversible", "irreversible"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const StepSchema = z.object({
  id: z.string().min(1),
  action: ActionTypeSchema,
  risk: RiskClassSchema,
  target: TargetSchema.optional(),
  valueFrom: ValueFromSchema.optional(),
  checkpoint: CheckpointSchema.optional(),
  notes: z.string().min(1).optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const HandlerThenSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("business_outcome"),
    code: BusinessOutcomeCodeSchema,
    message: z.string().min(1),
  }),
  z.object({
    kind: z.literal("recover"),
    steps: z.array(StepSchema).min(1),
  }),
  z.object({
    kind: z.literal("retry"),
    times: z.number().int().positive(),
    backoffMs: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("escalate"),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal("fail"),
    code: z.string().min(1),
  }),
]);
export type HandlerThen = z.infer<typeof HandlerThenSchema>;

export const ExceptionHandlerSchema = z.object({
  id: z.string().min(1),
  when: z.object({
    stepId: z.string().min(1).optional(),
    match: ErrorClassSchema,
    textMatches: z.array(z.string().min(1)).optional(),
  }),
  then: HandlerThenSchema,
});
export type ExceptionHandler = z.infer<typeof ExceptionHandlerSchema>;

export const PiiClassSchema = z.enum(["none", "identifier", "sensitive"]);
export type PiiClass = z.infer<typeof PiiClassSchema>;

export const ParameterSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["string", "number", "enum"]),
    required: z.boolean(),
    description: z.string().min(1),
    pii: PiiClassSchema,
    example: z.string().min(1).optional(),
    default: z.union([z.string(), z.number()]).optional(),
    enumValues: z.array(z.string().min(1)).optional(),
  })
  .superRefine((param, ctx) => {
    if (param.type === "enum" && (!param.enumValues || param.enumValues.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enum parameters require enumValues",
      });
    }
  });
export type Parameter = z.infer<typeof ParameterSchema>;

export const ExtractParseSchema = z.enum(["text", "currency", "integer"]);

export const ExtractorSchema = z.object({
  from: TargetSchema,
  parse: ExtractParseSchema,
});
export type Extractor = z.infer<typeof ExtractorSchema>;

export const OutputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().min(1),
  pii: PiiClassSchema,
  extractor: ExtractorSchema,
});
export type OutputSpec = z.infer<typeof OutputSchema>;

export const TenantBindingSchema = z.object({
  mode: z.enum(["canonical", "specialized"]),
  tenantId: z.string().min(1).optional(),
  baseCapabilityId: z.string().min(1).optional(),
  overrides: z
    .array(
      z.object({
        stepId: z.string().min(1),
        target: TargetSchema,
      }),
    )
    .optional(),
});
export type TenantBinding = z.infer<typeof TenantBindingSchema>;

export const CapabilitySchema = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal("Capability"),
    metadata: z.object({
      id: z.string().uuid(),
      name: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/, "name must be a lowercase slug"),
      title: z.string().min(1),
      description: z.string().min(1),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      createdAt: z.string().datetime(),
      sourceRunId: z.string().min(1),
      status: z.enum(["draft", "approved", "deprecated"]),
      vendorApp: z.object({
        id: z.string().min(1),
        version: z.string().min(1),
      }),
      tenant: TenantBindingSchema,
      surfaceKind: z.enum(["web", "desktop"]),
      tags: z.array(z.string().min(1)),
      confidence: z
        .object({
          replaySuccesses: z.number().int().nonnegative(),
          replayAttempts: z.number().int().nonnegative(),
          score: z.number().min(0).max(1),
        })
        .optional(),
    }),
    spec: z.object({
      entry: z.object({
        urlTemplate: z.string().min(1),
        surface: z.enum(["web", "desktop"]),
      }),
      parameters: z.array(ParameterSchema),
      outputs: z.array(OutputSchema),
      success: z.object({
        type: z.literal("checkpoint"),
        checkpointId: z.string().min(1),
      }),
      steps: z.array(StepSchema).min(1),
      exceptionHandlers: z.array(ExceptionHandlerSchema),
    }),
  })
  .superRefine((cap, ctx) => {
    const paramNames = new Set(cap.spec.parameters.map((p) => p.name));
    const stepIds = new Set(cap.spec.steps.map((s) => s.id));
    const checkpointIds = new Set(
      cap.spec.steps.filter((s) => s.checkpoint).map((s) => s.checkpoint!.id),
    );

    if (!checkpointIds.has(cap.spec.success.checkpointId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `success.checkpointId ${cap.spec.success.checkpointId} is not defined on any step`,
        path: ["spec", "success", "checkpointId"],
      });
    }

    for (const [i, step] of cap.spec.steps.entries()) {
      if (step.action === "fill" && !step.valueFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "fill steps require valueFrom",
          path: ["spec", "steps", i, "valueFrom"],
        });
      }
      if (step.valueFrom?.kind === "parameter" && !paramNames.has(step.valueFrom.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parameter ${step.valueFrom.name} is not declared`,
          path: ["spec", "steps", i, "valueFrom"],
        });
      }
      const needsTarget = ![
        "navigate",
        "wait_for",
        "assert_checkpoint",
        "human_step",
        "dismiss_dialog",
      ].includes(step.action);
      if (needsTarget && !step.target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${step.action} requires a target`,
          path: ["spec", "steps", i, "target"],
        });
      }
    }

    for (const [i, handler] of cap.spec.exceptionHandlers.entries()) {
      const stepId = handler.when.stepId;
      if (stepId && !stepIds.has(stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `handler refers to unknown step ${stepId}`,
          path: ["spec", "exceptionHandlers", i, "when", "stepId"],
        });
      }
    }
  });

export type Capability = z.infer<typeof CapabilitySchema>;

export const RunStatusSchema = z.enum(["success", "business_outcome", "escalated", "failed"]);

export const RunResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    runId: z.string().min(1),
    durationMs: z.number().nonnegative(),
    stepsCompleted: z.number().int().nonnegative(),
    outputs: z.record(z.union([z.string(), z.number(), z.boolean()])),
  }),
  z.object({
    status: z.literal("business_outcome"),
    runId: z.string().min(1),
    durationMs: z.number().nonnegative(),
    code: BusinessOutcomeCodeSchema,
    message: z.string().min(1),
    outputs: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    evidenceDir: z.string().min(1),
  }),
  z.object({
    status: z.literal("escalated"),
    runId: z.string().min(1),
    durationMs: z.number().nonnegative(),
    interventionId: z.string().min(1),
    reason: z.string().min(1),
    evidenceDir: z.string().min(1),
  }),
  z.object({
    status: z.literal("failed"),
    runId: z.string().min(1),
    durationMs: z.number().nonnegative(),
    class: z.enum(["hard", "timeout", "policy_violation"]),
    stepId: z.string().min(1),
    expected: z.string().min(1),
    observed: z.string().min(1),
    evidenceDir: z.string().min(1),
  }),
]);
export type RunResult = z.infer<typeof RunResultSchema>;
