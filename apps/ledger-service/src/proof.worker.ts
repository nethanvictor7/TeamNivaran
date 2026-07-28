import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Prisma } from "@cdep/ledger-prisma-client";
import { randomUUID } from "node:crypto";
import { canonicalize } from "./canonicalization.js";
import { getEnvironment } from "./environment.js";
import {
  LedgerProviderError,
  type ProviderNeutralProofEnvelope,
} from "./ledger-provider.js";
import { LEDGER_PROVIDER, type ProviderRegistry } from "./provider-registry.js";
import { PrismaService } from "./prisma.service.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class ProofWorker implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly owner = `ledger-worker-${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LEDGER_PROVIDER) private readonly providers: ProviderRegistry,
  ) {}

  onModuleInit() {
    if (!this.environment.LEDGER_WORKER_ENABLED) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.environment.LEDGER_WORKER_POLL_INTERVAL_MS,
    );
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.providers.active.close();
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const candidate = await this.prisma.proofRequest.findFirst({
        where: {
          state: { in: ["PENDING", "FAILED_RETRYABLE", "SUBMITTED"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          AND: [
            {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lt: now } },
                { leaseOwner: this.owner },
              ],
            },
          ],
        },
        orderBy: { requestedAt: "asc" },
      });
      if (!candidate) return;
      const acquired = await this.prisma.proofRequest.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lt: now } },
            { leaseOwner: this.owner },
          ],
        },
        data: {
          leaseOwner: this.owner,
          leaseExpiresAt: new Date(
            Date.now() + this.environment.LEDGER_WORKER_LEASE_SECONDS * 1000,
          ),
        },
      });
      if (acquired.count === 1) await this.process(candidate.id);
    } finally {
      this.running = false;
    }
  }

  async process(id: string) {
    const request = await this.prisma.proofRequest.findUnique({
      where: { id },
      include: { binding: true },
    });
    if (!request || request.state === "CONFIRMED") return;
    const provider = this.providers.forType(request.providerType);
    if (
      request.state === "SUBMITTED" &&
      request.binding?.providerTransactionId
    ) {
      const status = await provider.getTransaction({
        providerTransactionId: request.binding.providerTransactionId,
        providerProofReference:
          request.binding.providerProofReference ?? request.proofId,
      });
      if (status.state === "FINALIZED") {
        await this.confirmExisting(request.id);
        return;
      }
    }
    const attempt = request.attempts + 1;
    await this.prisma.proofRequest.update({
      where: { id },
      data: {
        state: "SUBMITTING",
        attempts: { increment: 1 },
        rowVersion: { increment: 1 },
      },
    });
    await this.prisma.ledgerTransaction.create({
      data: {
        proofRequestId: id,
        attemptNumber: attempt,
        providerType: request.providerType,
        normalizedState: "PENDING_FINALITY",
      },
    });
    try {
      const envelope =
        request.canonicalPayload as unknown as ProviderNeutralProofEnvelope;
      const submission = await provider.submitProof({
        envelope,
        canonicalBytes: canonicalize(
          envelope as unknown as import("./canonicalization.js").CanonicalJson,
        ),
        idempotencyKey: request.proofId,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.ledgerProviderBinding.upsert({
          where: { proofRequestId: id },
          create: {
            proofRequestId: id,
            providerType: request.providerType,
            providerTransactionId: submission.providerTransactionId,
            providerProofReference: submission.providerProofReference,
            providerContractReference: submission.providerContractReference,
            providerNetworkReference: submission.providerNetworkReference,
            providerMetadataSchemaVersion:
              submission.providerMetadataSchemaVersion,
            providerMetadata: json(submission.providerMetadata),
          },
          update: {
            providerTransactionId: submission.providerTransactionId,
            providerProofReference: submission.providerProofReference,
            providerMetadata: json(submission.providerMetadata),
          },
        });
        await tx.ledgerTransaction.update({
          where: {
            proofRequestId_attemptNumber: {
              proofRequestId: id,
              attemptNumber: attempt,
            },
          },
          data: {
            providerTransactionId: submission.providerTransactionId,
            normalizedState: submission.state,
            submittedAt: new Date(),
            ...(submission.state === "FINALIZED"
              ? { finalizedAt: new Date() }
              : {}),
          },
        });
        await tx.proofRequest.update({
          where: { id },
          data: {
            state: submission.state === "FINALIZED" ? "CONFIRMED" : "SUBMITTED",
            submittedAt: new Date(),
            ...(submission.state === "FINALIZED"
              ? { confirmedAt: new Date() }
              : {}),
            safeErrorCode: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            rowVersion: { increment: 1 },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "ProofRequest",
            aggregateId: id,
            aggregateVersion: request.rowVersion + 1,
            eventType: "proof.submitted",
            eventVersion: "1.0",
            organizationId: request.organizationId,
            correlationId: request.correlationId,
            actorId: "ledger-worker",
            payload: json({
              proofRequestId: id,
              proofId: request.proofId,
              kind: request.kind,
              providerType: request.providerType,
              providerTransactionId: submission.providerTransactionId,
              status: submission.state,
            }),
          },
        });
        if (request.kind === "EVIDENCE")
          await tx.evidenceProofRecord.update({
            where: { proofRequestId: id },
            data: { anchoredAt: new Date(submission.anchoredAt) },
          });
        else
          await tx.decisionProofRecord.update({
            where: { proofRequestId: id },
            data: { anchoredAt: new Date(submission.anchoredAt) },
          });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "ProofRequest",
            aggregateId: id,
            aggregateVersion: request.rowVersion + 2,
            eventType:
              request.kind === "DECISION"
                ? "decision-proof.confirmed"
                : "proof.confirmed",
            eventVersion: "1.0",
            organizationId: request.organizationId,
            correlationId: request.correlationId,
            actorId: "ledger-worker",
            payload: json({
              proofRequestId: id,
              proofId: request.proofId,
              kind: request.kind,
              providerType: request.providerType,
              providerTransactionId: submission.providerTransactionId,
              status: "CONFIRMED",
            }),
          },
        });
      });
    } catch (error) {
      const providerError =
        error instanceof LedgerProviderError
          ? error
          : new LedgerProviderError("LEDGER_SUBMISSION_FAILED", true);
      const retryable =
        providerError.retryable &&
        attempt < this.environment.LEDGER_RETRY_MAX_ATTEMPTS;
      const state = providerError.conflict
        ? "CONFLICT"
        : retryable
          ? "FAILED_RETRYABLE"
          : "FAILED_PERMANENT";
      await this.prisma.$transaction(async (tx) => {
        await tx.ledgerTransaction.update({
          where: {
            proofRequestId_attemptNumber: {
              proofRequestId: id,
              attemptNumber: attempt,
            },
          },
          data: {
            normalizedState: providerError.conflict
              ? "REJECTED"
              : "UNAVAILABLE",
            retryable,
            safeErrorCode: providerError.code,
          },
        });
        await tx.proofRequest.update({
          where: { id },
          data: {
            state,
            safeErrorCode: providerError.code,
            nextAttemptAt: retryable
              ? new Date(Date.now() + Math.min(30_000, 500 * 2 ** attempt))
              : null,
            leaseOwner: null,
            leaseExpiresAt: null,
            rowVersion: { increment: 1 },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "ProofRequest",
            aggregateId: id,
            aggregateVersion: request.rowVersion + 2,
            eventType: "proof.failed",
            eventVersion: "1.0",
            organizationId: request.organizationId,
            correlationId: request.correlationId,
            actorId: "ledger-worker",
            payload: json({
              proofRequestId: id,
              proofId: request.proofId,
              kind: request.kind,
              providerType: request.providerType,
              status: state,
              safeErrorCode: providerError.code,
              retryable,
            }),
          },
        });
      });
    }
  }

  private async confirmExisting(id: string) {
    await this.prisma.proofRequest.update({
      where: { id },
      data: {
        state: "CONFIRMED",
        confirmedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        rowVersion: { increment: 1 },
      },
    });
  }
}
