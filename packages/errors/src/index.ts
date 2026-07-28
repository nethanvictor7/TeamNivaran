import { z } from "zod";

export const apiErrorSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  detail: z.string(),
  instance: z.string(),
  correlationId: z.string(),
  timestamp: z.iso.datetime(),
  errors: z
    .array(
      z.object({
        field: z.string(),
        code: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export function createApiError(
  status: number,
  code: string,
  title: string,
  detail: string,
  instance: string,
  correlationId: string,
): ApiError {
  return {
    type: `https://cdep.local/problems/${code.toLowerCase()}`,
    title,
    status,
    code,
    detail,
    instance,
    correlationId,
    timestamp: new Date().toISOString(),
  };
}
