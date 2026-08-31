import { z } from "zod";

const sourceIdSchema = z.string().regex(/^S[1-9]\d*$/u);

const answeredGenerationResultSchema = z
  .object({
    status: z.literal("answered"),
    answer: z.string().trim().min(1).max(8000),
    sourceIds: z.array(sourceIdSchema).min(1).max(8),
  })
  .strict();

const insufficientContextGenerationResultSchema = z
  .object({
    status: z.literal("insufficient_context"),
    answer: z.string().trim().min(1).max(8000),
    sourceIds: z.array(sourceIdSchema).length(0),
  })
  .strict();

export const groundedAnswerGenerationResultSchema = z.discriminatedUnion("status", [
  answeredGenerationResultSchema,
  insufficientContextGenerationResultSchema,
]);

export interface GroundedAnswerGenerationSource {
  sourceId: string;
  content: string;
  originalFilename: string;
  pageNumber: number | null;
  ordinal: number;
}

export interface GroundedAnswerGenerationInput {
  question: string;
  sources: GroundedAnswerGenerationSource[];
}

export type GroundedAnswerGenerationResult = z.infer<
  typeof groundedAnswerGenerationResultSchema
>;

export interface GroundedAnswerGenerator {
  readonly model: string;
  generate(input: GroundedAnswerGenerationInput): Promise<GroundedAnswerGenerationResult>;
}
