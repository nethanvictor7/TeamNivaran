import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : 500;
    const detail =
      error instanceof ZodError
        ? "The request does not match the approved audit API schema."
        : error instanceof HttpException
          ? typeof error.getResponse() === "string"
            ? error.getResponse()
            : Array.isArray(
                  (error.getResponse() as { message?: unknown }).message,
                )
              ? "The audit request is invalid."
              : String(
                  (error.getResponse() as { message?: unknown }).message ??
                    error.message,
                )
          : "The audit request could not be completed.";
    return response.code(status).send({
      type: `https://cdep.local/problems/${status === 500 ? "internal-error" : "audit-request"}`,
      title: status === 500 ? "Internal service error" : "Audit request failed",
      status,
      code: status === 500 ? "AUDIT_INTERNAL_ERROR" : "AUDIT_REQUEST_FAILED",
      detail,
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
