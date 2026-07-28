import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createApiError } from "@cdep/errors";

const codes: Record<number, string> = {
  400: "VALIDATION_FAILED",
  401: "AUTHENTICATION_REQUIRED",
  403: "PERMISSION_DENIED",
  404: "RESOURCE_NOT_FOUND",
  409: "VERSION_CONFLICT",
  422: "INVALID_STATE_TRANSITION",
  503: "SERVICE_UNAVAILABLE",
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const response =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const detail =
      typeof response === "string"
        ? response
        : typeof response === "object" && response && "message" in response
          ? Array.isArray(response.message)
            ? response.message.join("; ")
            : String(response.message)
          : status === 500
            ? "An unexpected error occurred."
            : "The request could not be processed.";
    reply
      .code(status)
      .send(
        createApiError(
          status,
          codes[status] ?? "INTERNAL_ERROR",
          status === 500
            ? "Internal server error"
            : exception instanceof Error
              ? exception.name.replace("Exception", "")
              : "Request failed",
          detail,
          request.url,
          request.id,
        ),
      );
  }
}
