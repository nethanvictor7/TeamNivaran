import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@cdep/ledger-prisma-client";
import { createHash, randomUUID } from "node:crypto";
import type { LedgerIdentity } from "./authentication.js";
import {
  canonicalSha256,
  canonicalize,
  opaqueScopeHash,
  type CanonicalJson,
} from "./canonicalization.js";
import { DependencyClients } from "./dependency-clients.js";
import { LEDGER_PROVIDER, type ProviderRegistry } from "./provider-registry.js";
import { PrismaService } from "./prisma.service.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const requestHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

@Injectable()
export class ProofService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dependencies: DependencyClients,
    @Inject(LEDGER_PROVIDER) private readonly providers: ProviderRegistry,
  ) {}

  async createEvidence(
    evidenceAssetId: string,
    evidenceVersionId: string,
    identity: LedgerIdentity,
    correlationId: string,
    idempotencyKey: string,
  ) {
    this.assertKey(idempotencyKey);
    const route = `/api/v1/evidence/${evidenceAssetId}/versions/${evidenceVersionId}/proofs`;
    const prior = await this.idempotent(
      identity,
      route,
      idempotencyKey,
      requestHash(`${evidenceAssetId}:${evidenceVersionId}`),
    );
    if (prior) return prior;
    const snapshot = await this.dependencies.evidenceSnapshot(
      identity.organizationId,
      evidenceAssetId,
      evidenceVersionId,
      correlationId,
    );
    const content = await this.dependencies.evidenceContentHash(
      snapshot,
      correlationId,
    );
    if (content.sha256 !== snapshot.sha256)
      throw new ConflictException(
        "The exact Evidence content failed integrity verification.",
      );
    const previous = snapshot.previousVersionId
      ? await this.prisma.evidenceProofRecord.findFirst({
          where: {
            organizationId: identity.organizationId,
            evidenceAssetId,
            evidenceVersionId: snapshot.previousVersionId,
          },
          orderBy: { anchoredAt: "desc" },
        })
      : null;
    const metadata = {
      schemaVersion: "1.0",
      evidenceId: evidenceAssetId,
      evidenceVersionId,
      versionNumber: snapshot.versionNumber,
      classificationCode: snapshot.classificationCode,
      mediaType: snapshot.mediaType,
      sizeBytes: snapshot.sizeBytes,
      availableAt: snapshot.availableAt,
      authoritative: snapshot.authoritative,
    } satisfies CanonicalJson;
    const envelope = {
      kind: "EVIDENCE" as const,
      schemaVersion: "1.0" as const,
      proofId: randomUUID(),
      organizationScopeHash: opaqueScopeHash(identity.organizationId),
      caseReferenceHash: opaqueScopeHash(snapshot.caseId),
      evidenceId: evidenceAssetId,
      evidenceVersionId,
      contentSha256: snapshot.sha256,
      metadataSha256: canonicalSha256(metadata),
      previousProofId: previous?.proofId ?? null,
    };
    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.proofRequest.create({
        data: {
          proofId: envelope.proofId,
          organizationId: identity.organizationId,
          caseId: snapshot.caseId,
          kind: "EVIDENCE",
          evidenceAssetId,
          evidenceVersionId,
          canonicalPayload: json(envelope),
          canonicalSha256: canonicalSha256(envelope),
          providerType: this.providers.active.providerType,
          requestedBy: identity.userId,
          correlationId,
          evidenceRecord: {
            create: {
              proofId: envelope.proofId,
              organizationId: identity.organizationId,
              caseId: snapshot.caseId,
              evidenceAssetId,
              evidenceVersionId,
              contentSha256: snapshot.sha256,
              metadataSha256: envelope.metadataSha256,
              previousProofId: envelope.previousProofId,
              schemaVersion: "1.0",
            },
          },
        },
      });
      const response = this.summary(request);
      await tx.idempotencyRecord.create({
        data: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key: idempotencyKey,
          requestHash: requestHash(`${evidenceAssetId}:${evidenceVersionId}`),
          responseBody: json(response),
        },
      });
      await this.event(tx, request, "proof.requested", identity.userId);
      return response;
    });
    return created;
  }

  async createDecision(
    caseId: string,
    identity: LedgerIdentity,
    correlationId: string,
    idempotencyKey: string,
  ) {
    this.assertKey(idempotencyKey);
    const route = `/api/v1/cases/${caseId}/decision-proof`;
    const snapshot = await this.dependencies.decisionSnapshot(
      identity.organizationId,
      caseId,
      correlationId,
    );
    const hash = requestHash(snapshot.decision.id);
    const prior = await this.idempotent(identity, route, idempotencyKey, hash);
    if (prior) return prior;
    const evidenceManifest = [...snapshot.evidenceManifest].sort((a, b) =>
      a.evidenceVersionId.localeCompare(b.evidenceVersionId),
    ) as unknown as CanonicalJson;
    const recommendation = snapshot.recommendation as unknown as CanonicalJson;
    const decision = snapshot.decision as unknown as CanonicalJson;
    const envelope = {
      kind: "DECISION" as const,
      schemaVersion: "1.0" as const,
      proofId: randomUUID(),
      caseReferenceHash: opaqueScopeHash(caseId),
      workflowInstanceId: snapshot.workflowInstanceId,
      decisionId: snapshot.decision.id,
      decisionOutcomeCode: snapshot.decision.outcome,
      evidenceManifestSha256: canonicalSha256(evidenceManifest),
      recommendationSha256: canonicalSha256(recommendation),
      decisionRecordSha256: canonicalSha256(decision),
    };
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.proofRequest.create({
        data: {
          proofId: envelope.proofId,
          organizationId: identity.organizationId,
          caseId,
          kind: "DECISION",
          decisionId: snapshot.decision.id,
          canonicalPayload: json(envelope),
          canonicalSha256: canonicalSha256(envelope),
          providerType: this.providers.active.providerType,
          requestedBy: identity.userId,
          correlationId,
          decisionRecord: {
            create: {
              proofId: envelope.proofId,
              organizationId: identity.organizationId,
              caseId,
              workflowInstanceId: snapshot.workflowInstanceId,
              decisionId: snapshot.decision.id,
              decisionOutcomeCode: snapshot.decision.outcome,
              evidenceManifestSha256: envelope.evidenceManifestSha256,
              recommendationSha256: envelope.recommendationSha256,
              decisionRecordSha256: envelope.decisionRecordSha256,
              schemaVersion: "1.0",
            },
          },
        },
      });
      const response = this.summary(request);
      await tx.idempotencyRecord.create({
        data: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key: idempotencyKey,
          requestHash: hash,
          responseBody: json(response),
        },
      });
      await this.event(tx, request, "proof.requested", identity.userId);
      return response;
    });
  }

  listEvidence(
    evidenceAssetId: string,
    evidenceVersionId: string,
    identity: LedgerIdentity,
  ) {
    return this.prisma.proofRequest.findMany({
      where: {
        organizationId: identity.organizationId,
        kind: "EVIDENCE",
        evidenceAssetId,
        evidenceVersionId,
      },
      include: {
        binding: true,
        evidenceRecord: true,
        verifications: { orderBy: { verifiedAt: "desc" }, take: 5 },
      },
      orderBy: { requestedAt: "desc" },
    });
  }

  async getDecision(caseId: string, identity: LedgerIdentity) {
    const proof = await this.prisma.proofRequest.findFirst({
      where: {
        organizationId: identity.organizationId,
        caseId,
        kind: "DECISION",
      },
      include: {
        binding: true,
        decisionRecord: true,
        verifications: { orderBy: { verifiedAt: "desc" }, take: 5 },
      },
      orderBy: { requestedAt: "desc" },
    });
    if (!proof) throw new NotFoundException("Decision proof not found.");
    return proof;
  }

  async verifyEvidence(
    evidenceAssetId: string,
    evidenceVersionId: string,
    identity: LedgerIdentity,
    correlationId: string,
  ) {
    const proof = await this.prisma.proofRequest.findFirst({
      where: {
        organizationId: identity.organizationId,
        evidenceAssetId,
        evidenceVersionId,
        kind: "EVIDENCE",
      },
      include: { evidenceRecord: true, binding: true },
      orderBy: { requestedAt: "desc" },
    });
    if (!proof?.evidenceRecord)
      throw new NotFoundException("Evidence proof not found.");
    const snapshot = await this.dependencies.evidenceSnapshot(
      identity.organizationId,
      evidenceAssetId,
      evidenceVersionId,
      correlationId,
    );
    const content = await this.dependencies.evidenceContentHash(
      snapshot,
      correlationId,
    );
    return this.recordVerification(
      proof,
      identity,
      [content.sha256, proof.evidenceRecord.metadataSha256],
      content.sha256 === proof.evidenceRecord.contentSha256,
    );
  }

  async verifyDecision(
    caseId: string,
    identity: LedgerIdentity,
    correlationId: string,
  ) {
    const proof = await this.prisma.proofRequest.findFirst({
      where: {
        organizationId: identity.organizationId,
        caseId,
        kind: "DECISION",
      },
      include: { decisionRecord: true, binding: true },
      orderBy: { requestedAt: "desc" },
    });
    if (!proof?.decisionRecord)
      throw new NotFoundException("Decision proof not found.");
    const snapshot = await this.dependencies.decisionSnapshot(
      identity.organizationId,
      caseId,
      correlationId,
    );
    const hashes = [
      canonicalSha256(
        [...snapshot.evidenceManifest].sort((a, b) =>
          a.evidenceVersionId.localeCompare(b.evidenceVersionId),
        ) as unknown as CanonicalJson,
      ),
      canonicalSha256(snapshot.recommendation as unknown as CanonicalJson),
      canonicalSha256(snapshot.decision as unknown as CanonicalJson),
    ];
    const localMatch =
      hashes[0] === proof.decisionRecord.evidenceManifestSha256 &&
      hashes[1] === proof.decisionRecord.recommendationSha256 &&
      hashes[2] === proof.decisionRecord.decisionRecordSha256;
    return this.recordVerification(proof, identity, hashes, localMatch);
  }

  async transaction(id: string, identity: LedgerIdentity) {
    const binding = await this.prisma.ledgerProviderBinding.findFirst({
      where: {
        providerTransactionId: id,
        request: { organizationId: identity.organizationId },
      },
      include: { request: true },
    });
    if (!binding) throw new NotFoundException("Ledger transaction not found.");
    const provider = this.providers.forType(binding.providerType);
    return {
      proofRequestId: binding.proofRequestId,
      providerType: binding.providerType,
      ...(await provider.getTransaction({
        providerTransactionId: id,
        providerProofReference: binding.providerProofReference ?? "",
      })),
    };
  }

  async retry(id: string, identity: LedgerIdentity) {
    const request = await this.prisma.proofRequest.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!request) throw new NotFoundException("Proof request not found.");
    if (request.state !== "FAILED_RETRYABLE")
      throw new ConflictException("The proof request is not retryable.");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.proofRequest.update({
        where: { id },
        data: {
          state: "PENDING",
          nextAttemptAt: null,
          safeErrorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.event(tx, updated, "proof.retried", identity.userId);
      return updated;
    });
  }

  networkStatus() {
    return this.providers.active.getHealth();
  }

  async reconcile(identity: LedgerIdentity) {
    const run = await this.prisma.ledgerReconciliationRun.create({
      data: {
        requestedBy: identity.userId,
        organizationId: identity.organizationId,
        status: "RUNNING",
      },
    });
    const requests = await this.prisma.proofRequest.findMany({
      where: {
        organizationId: identity.organizationId,
        state: { in: ["SUBMITTED", "FAILED_RETRYABLE"] },
      },
      include: { binding: true },
      take: 100,
    });
    let confirmed = 0;
    let failed = 0;
    for (const request of requests) {
      if (!request.binding?.providerTransactionId) {
        failed += 1;
        continue;
      }
      const status = await this.providers
        .forType(request.binding.providerType)
        .getTransaction({
          providerTransactionId: request.binding.providerTransactionId,
          providerProofReference:
            request.binding.providerProofReference ?? request.proofId,
        });
      if (status.state === "FINALIZED") {
        confirmed += 1;
        await this.prisma.proofRequest.update({
          where: { id: request.id },
          data: { state: "CONFIRMED", confirmedAt: new Date() },
        });
      } else failed += 1;
    }
    return this.prisma.ledgerReconciliationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        inspected: requests.length,
        confirmed,
        failed,
        completedAt: new Date(),
      },
    });
  }

  private async recordVerification(
    proof: {
      id: string;
      proofId: string;
      providerType: string;
      state: string;
      organizationId: string;
    },
    identity: LedgerIdentity,
    hashes: string[],
    localMatch: boolean,
  ) {
    const provider = this.providers.forType(proof.providerType);
    const result = await provider.verifyProof({
      proofId: proof.proofId,
      expectedHashes: hashes,
    });
    const attempt = await this.prisma.$transaction(async (tx) => {
      const created = await tx.verificationAttempt.create({
        data: {
          proofRequestId: proof.id,
          organizationId: identity.organizationId,
          requestedBy: identity.userId,
          offLedgerHashMatch: localMatch,
          ledgerProofConfirmed:
            result.proofConfirmed && result.state === "FINALIZED",
          ledgerHashMatch: result.hashMatch,
          providerState: result.state,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "ProofRequest",
          aggregateId: proof.id,
          aggregateVersion: 1,
          eventType: "proof.verification.completed",
          eventVersion: "1.0",
          organizationId: identity.organizationId,
          correlationId: randomUUID(),
          actorId: identity.userId,
          payload: json({
            proofRequestId: proof.id,
            proofId: proof.proofId,
            providerType: proof.providerType,
            offLedgerHashMatch: localMatch,
            ledgerProofConfirmed:
              result.proofConfirmed && result.state === "FINALIZED",
            ledgerHashMatch: result.hashMatch,
            providerState: result.state,
          }),
        },
      });
      return created;
    });
    return {
      id: attempt.id,
      proofRequestId: proof.id,
      providerType: proof.providerType,
      offLedgerStatus: localMatch
        ? "OFF_LEDGER_HASH_MATCH"
        : "OFF_LEDGER_HASH_MISMATCH",
      ledgerProofStatus: attempt.ledgerProofConfirmed
        ? "LEDGER_PROOF_CONFIRMED"
        : "LEDGER_PROOF_UNCONFIRMED",
      ledgerHashStatus: attempt.ledgerHashMatch
        ? "LEDGER_HASH_MATCH"
        : "LEDGER_HASH_MISMATCH",
      providerState: result.state,
      verifiedAt: attempt.verifiedAt,
    };
  }

  private async idempotent(
    identity: LedgerIdentity,
    route: string,
    key: string,
    hash: string,
  ) {
    const prior = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_actorId_route_key: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key,
        },
      },
    });
    if (!prior) return null;
    if (prior.requestHash !== hash)
      throw new ConflictException(
        "The Idempotency-Key was used for a different proof request.",
      );
    return prior.responseBody;
  }

  private assertKey(key: string) {
    if (!key || key.length > 200)
      throw new BadRequestException("A valid Idempotency-Key is required.");
  }

  private summary(request: {
    id: string;
    proofId: string;
    kind: string;
    state: string;
    providerType: string;
    requestedAt: Date;
  }) {
    return {
      id: request.id,
      proofId: request.proofId,
      kind: request.kind,
      status: request.state,
      providerType: request.providerType,
      requestedAt: request.requestedAt,
    };
  }

  private async event(
    tx: Prisma.TransactionClient,
    request: {
      id: string;
      proofId: string;
      organizationId: string;
      caseId: string;
      kind: string;
      providerType: string;
      rowVersion: number;
      correlationId: string;
    },
    eventType: string,
    actorId: string,
  ) {
    await tx.outboxEvent.create({
      data: {
        aggregateType: "ProofRequest",
        aggregateId: request.id,
        aggregateVersion: request.rowVersion,
        eventType,
        eventVersion: "1.0",
        organizationId: request.organizationId,
        correlationId: request.correlationId,
        actorId,
        payload: json({
          proofRequestId: request.id,
          proofId: request.proofId,
          kind: request.kind,
          providerType: request.providerType,
          status: eventType === "proof.requested" ? "PENDING" : eventType,
        }),
      },
    });
  }
}
