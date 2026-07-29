import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    const detail =
      typeof raw === "string"
        ? raw
        : raw &&
            typeof raw === "object" &&
            "message" in raw &&
            typeof raw.message === "string"
          ? raw.message
          : status === 500
            ? "An unexpected ledger-service error occurred."
            : "The request could not be completed.";
    void response.status(status).send({
      type: `https://cdep.local/problems/${status}`,
      title: HttpStatus[status] ?? "Error",
      status,
      code: `LEDGER_${status}`,
      detail,
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
