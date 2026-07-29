import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

@Catch()
export class ProblemFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const response =
      error instanceof HttpException ? error.getResponse() : null;
    const detail =
      typeof response === "string"
        ? response
        : response && typeof response === "object" && "message" in response
          ? Array.isArray(response.message)
            ? response.message.join("; ")
            : String(response.message)
          : status === 500
            ? "The AI assessment request could not be completed."
            : "The request could not be completed.";
    return reply.code(status).send({
      type: `https://cdep.local/problems/ai-${status}`,
      title: HttpStatus[status] ?? "Error",
      status,
      code: `AI_${status}`,
      detail,
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
