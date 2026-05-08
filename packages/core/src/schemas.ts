import { z } from 'zod';

/**
 * Zod schemas for validating parsed AOML structures and adapter responses.
 */

export const TriggerSchema = z.object({
  type: z.enum(['manual', 'schedule', 'webhook']),
});

export const VarSchema = z.object({
  name: z.string().min(1),
  required: z.boolean(),
});

export const GlobalsSchema = z.object({
  vars: z.array(VarSchema).min(1),
});

export const InputSchema = z.object({
  format: z.enum(['text', 'json']).optional(),
  mapTo: z.string().optional(),
  text: z.string(),
});

export const OutputSchema = z.object({
  saveAs: z.string().min(1),
});

export const OnStatusSchema = z.object({
  value: z.string().min(1),
  goto: z.string().min(1),
  passFeedback: z.boolean().optional(),
});

export const OnErrorSchema = z.object({
  goto: z.string().min(1),
  retryCount: z.number().int().min(0),
});

export const OnMaxRetriesSchema = z.object({
  goto: z.string().min(1),
});

export const RoutingSchema = z.object({
  onStatus: z.array(OnStatusSchema).min(1),
  onError: OnErrorSchema.optional(),
  onMaxRetries: OnMaxRetriesSchema.optional(),
});

export const LoopSchema = z.object({
  source: z.string().min(1),
  as: z.string().min(1),
  mode: z.enum(['parallel', 'sequential']),
});

export const StepSchema = z
  .object({
    id: z.string().min(1),
    agent: z.string().optional(),
    type: z.literal('subflow').optional(),
    src: z.string().optional(),
    input: InputSchema.optional(),
    output: OutputSchema.optional(),
    routing: RoutingSchema.optional(),
    loop: LoopSchema.optional(),
  })
  .refine(
    (step) => {
      if (step.type === 'subflow') return !!step.src;
      return true;
    },
    { message: 'Subflow steps must have a "src" attribute' }
  )
  .refine(
    (step) => {
      if (!step.type) return !!step.agent;
      return true;
    },
    { message: 'Non-subflow steps must have an "agent" attribute' }
  );

export const EvaluateSchema = z.object({
  agent: z.string().min(1),
  prompt: z.string().min(1),
});

export const PostProcessSchema = z.object({
  evaluations: z.array(EvaluateSchema).min(1),
});

export const ProcessSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['workflow', 'pipeline']),
  trigger: TriggerSchema.optional(),
  globals: GlobalsSchema.optional(),
  steps: z.array(StepSchema).min(1),
  postProcess: PostProcessSchema.optional(),
});

// Adapter Response schema (TSD §5.4)
export const AdapterResponseSchema = z.object({
  status: z.string().describe("The routing status, e.g., 'approve' or 'reject'"),
  extractedData: z.string().describe('The clean code or summarized feedback'),
});

export type ValidatedProcess = z.infer<typeof ProcessSchema>;
export type ValidatedAdapterResponse = z.infer<typeof AdapterResponseSchema>;
