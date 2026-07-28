import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const response =
      error instanceof HttpException ? error.getResponse() : undefined;
    const detail =
      typeof response === "string"
        ? response
        : response &&
            typeof response === "object" &&
            "message" in response &&
            typeof response.message === "string"
          ? response.message
          : status === 500
            ? "The Workflow service could not process the request."
            : "The request could not be processed.";
    const title =
      status === 400
        ? "Invalid request"
        : status === 401
          ? "Authentication required"
          : status === 403
            ? "Permission denied"
            : status === 404
              ? "Workflow resource not found"
              : status === 409
                ? "Workflow conflict"
                : status === 422
                  ? "Workflow guard failed"
                  : status === 503
                    ? "Workflow dependency unavailable"
                    : "Workflow service error";
    return reply.code(status).send({
      type: `https://cdep.local/problems/workflow-${status}`,
      title,
      status,
      code: `WORKFLOW_${status}`,
      detail,
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
