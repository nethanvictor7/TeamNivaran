import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  caseLedgerSummarySchema,
  caseProofListQuerySchema,
  caseProofListResponseSchema,
  caseProofSchema,
  type CaseProof,
  type CaseProofListQuery,
} from "@cdep/contracts";
import type { Prisma } from "@cdep/ledger-prisma-client";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { LedgerIdentity } from "./authentication.js";
import { DependencyClients } from "./dependency-clients.js";
import { getEnvironment } from "./environment.js";
import { LEDGER_PROVIDER, type ProviderRegistry } from "./provider-registry.js";
import { PrismaService } from "./prisma.service.js";

type ProofRow = Prisma.ProofRequestGetPayload<{
  include: {
    binding: true;
    evidenceRecord: true;
    decisionRecord: true;
    transactions: true;
    verifications: true;
  };
}>;

type Cursor = {
  organizationId: string;
  caseId: string;
  requestedAt: string;
  id: string;
  filterHash: string;
};

const lifecycle = (state: string): CaseProof["lifecycle"] => {
  if (state === "SUBMITTED") return "SUBMITTED";
  if (state === "CONFIRMED") return "CONFIRMED";
  if (["FAILED_RETRYABLE", "FAILED_PERMANENT", "CONFLICT"].includes(state))
    return "FAILED";
  return "PENDING";
};

@Injectable()
export class CaseProofReadService {
  private readonly environment = getEnvironment();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dependencies: DependencyClients,
    @Inject(LEDGER_PROVIDER) private readonly providers: ProviderRegistry,
  ) {}

  async summary(
    caseId: string,
    identity: LedgerIdentity,
    correlationId: string,
  ) {
    await this.dependencies.caseSnapshot(
      identity.organizationId,
      caseId,
      correlationId,
    );
    const [evidence, proofRows, health, decision] = await Promise.all([
      this.dependencies.caseEvidenceSnapshot(
        identity.organizationId,
        caseId,
        correlationId,
      ),
      this.prisma.proofRequest.findMany({
        where: { organizationId: identity.organizationId, caseId },
        include: {
          binding: true,
          evidenceRecord: true,
          decisionRecord: true,
          transactions: { orderBy: { attemptNumber: "desc" }, take: 1 },
          verifications: { orderBy: { verifiedAt: "desc" }, take: 1 },
        },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      }),
      this.providers.active.getHealth(),
      this.optionalDecision(identity.organizationId, caseId, correlationId),
    ]);
    const proofs = proofRows.map((row) => this.present(row, []));
    const evidenceProofs = new Map(
      proofs
        .filter(
          (proof) => proof.proofType === "EVIDENCE" && proof.evidenceVersionId,
        )
        .map((proof) => [proof.evidenceVersionId!, proof]),
    );
    const evidenceTargets = evidence.items.map((item) => {
      const proof = evidenceProofs.get(item.evidenceVersionId);
      return {
        evidenceId: item.evidenceAssetId,
        evidenceVersionId: item.evidenceVersionId,
        classificationCode: item.classificationCode,
        eligibility: proof
          ? ("ANCHOR_REQUESTED" as const)
          : ("ELIGIBLE_NOT_ANCHORED" as const),
        lifecycle: proof?.lifecycle ?? null,
        proofRequestId: proof?.proofRequestId ?? null,
        requestedAt: proof?.requestedAt ?? null,
      };
    });
    const counts = {
      eligible: evidenceTargets.length,
      pending: evidenceTargets.filter((item) => item.lifecycle === "PENDING")
        .length,
      submitted: evidenceTargets.filter(
        (item) => item.lifecycle === "SUBMITTED",
      ).length,
      confirmed: evidenceTargets.filter(
        (item) => item.lifecycle === "CONFIRMED",
      ).length,
      failed: evidenceTargets.filter((item) => item.lifecycle === "FAILED")
        .length,
      notAnchored: evidenceTargets.filter((item) => item.lifecycle === null)
        .length,
    };
    const decisionProof = proofs.find(
      (proof) => proof.proofType === "DECISION",
    );
    const decisionView = decision
      ? {
          eligibility: decisionProof
            ? ("ANCHOR_REQUESTED" as const)
            : ("ELIGIBLE_NOT_ANCHORED" as const),
          reasonCode: null,
          explanation: decisionProof
            ? "A decision proof request exists for the terminal decision."
            : "The terminal decision is eligible for anchoring.",
          decisionId: decision.decision.id,
          decisionOutcome: decision.decision.outcome,
          lifecycle: decisionProof?.lifecycle ?? null,
          proofRequestId: decisionProof?.proofRequestId ?? null,
        }
      : {
          eligibility: "NOT_ELIGIBLE" as const,
          reasonCode: "TERMINAL_DECISION_REQUIRED",
          explanation:
            "A decision proof becomes eligible after an approved or rejected terminal decision.",
          decisionId: null,
          decisionOutcome: null,
          lifecycle: null,
          proofRequestId: null,
        };
    const latestVerification =
      proofs
        .filter((proof) => proof.verification.verifiedAt)
        .sort((left, right) =>
          right.verification.verifiedAt!.localeCompare(
            left.verification.verifiedAt!,
          ),
        )[0]?.verification ?? null;
    const latestConfirmed =
      proofs.find((proof) => proof.lifecycle === "CONFIRMED") ?? null;
    const hasMismatch = proofs.some(
      (proof) =>
        proof.verification.offLedgerHash === "MISMATCH" ||
        proof.verification.ledgerHash === "MISMATCH" ||
        proof.verification.ledgerConfirmation === "NOT_FOUND",
    );
    const eligibleTotal = counts.eligible + (decision ? 1 : 0);
    const confirmedTotal =
      counts.confirmed + (decisionProof?.lifecycle === "CONFIRMED" ? 1 : 0);
    const activeTotal =
      counts.pending +
      counts.submitted +
      (decisionProof &&
      ["PENDING", "SUBMITTED"].includes(decisionProof.lifecycle)
        ? 1
        : 0);
    const state =
      health.state !== "AVAILABLE"
        ? "LEDGER_UNAVAILABLE"
        : hasMismatch
          ? "VERIFICATION_ISSUE"
          : eligibleTotal === 0
            ? "NOT_ELIGIBLE"
            : confirmedTotal === eligibleTotal
              ? "ANCHORED"
              : confirmedTotal > 0
                ? "PARTIALLY_ANCHORED"
                : activeTotal > 0
                  ? "ANCHORING"
                  : "NOT_YET_ANCHORED";
    const now = new Date();
    return caseLedgerSummarySchema.parse({
      caseId,
      state,
      ledgerAvailability: {
        available: health.state === "AVAILABLE",
        providerType: health.providerType,
        status: health.state,
        checkedAt: now.toISOString(),
        safeErrorCode:
          health.state === "AVAILABLE" ? null : "LEDGER_PROVIDER_UNAVAILABLE",
      },
      decision: decisionView,
      evidenceCounts: counts,
      evidenceTargets,
      latestVerification,
      latestConfirmed,
      freshness: {
        generatedAt: now.toISOString(),
        evidenceSnapshotAt: evidence.snapshotAt,
        staleAfter: new Date(now.valueOf() + 30_000).toISOString(),
      },
    });
  }

  async list(
    caseId: string,
    identity: LedgerIdentity,
    correlationId: string,
    input: unknown,
  ) {
    await this.dependencies.caseSnapshot(
      identity.organizationId,
      caseId,
      correlationId,
    );
    const parsed = caseProofListQuerySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid case proof list query.");
    const query = parsed.data;
    const filterHash = this.filterHash(query);
    const cursor = query.cursor
      ? this.decodeCursor(
          query.cursor,
          identity.organizationId,
          caseId,
          filterHash,
        )
      : null;
    const rows = await this.prisma.proofRequest.findMany({
      where: {
        organizationId: identity.organizationId,
        caseId,
        ...(query.proofType ? { kind: query.proofType } : {}),
        ...(query.providerType ? { providerType: query.providerType } : {}),
        ...(query.evidenceId ? { evidenceAssetId: query.evidenceId } : {}),
        ...(query.evidenceVersionId
          ? { evidenceVersionId: query.evidenceVersionId }
          : {}),
        ...(query.status
          ? { state: { in: this.storedStates(query.status) } }
          : {}),
        ...(cursor
          ? {
              OR: [
                { requestedAt: { lt: new Date(cursor.requestedAt) } },
                {
                  requestedAt: new Date(cursor.requestedAt),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      include: {
        binding: true,
        evidenceRecord: true,
        decisionRecord: true,
        transactions: { orderBy: { attemptNumber: "desc" }, take: 1 },
        verifications: { orderBy: { verifiedAt: "desc" }, take: 1 },
      },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: query.pageSize + 1,
    });
    const page = rows.slice(0, query.pageSize);
    const events = page.length
      ? await this.prisma.outboxEvent.findMany({
          where: {
            organizationId: identity.organizationId,
            aggregateId: { in: page.map((row) => row.id) },
          },
          orderBy: { occurredAt: "asc" },
        })
      : [];
    const byProof = new Map<string, typeof events>();
    for (const event of events) {
      const current = byProof.get(event.aggregateId) ?? [];
      current.push(event);
      byProof.set(event.aggregateId, current);
    }
    const last = page.at(-1);
    return caseProofListResponseSchema.parse({
      items: page.map((row) =>
        this.present(
          row,
          (byProof.get(row.id) ?? []).map((event) => ({
            id: event.id,
            eventType: event.eventType,
            status: this.eventStatus(event.eventType),
            occurredAt: event.occurredAt.toISOString(),
            actorId: event.actorId,
          })),
        ),
      ),
      nextCursor:
        rows.length > query.pageSize && last
          ? this.encodeCursor({
              organizationId: identity.organizationId,
              caseId,
              requestedAt: last.requestedAt.toISOString(),
              id: last.id,
              filterHash,
            })
          : null,
      pageSize: query.pageSize,
    });
  }

  private present(row: ProofRow, history: CaseProof["history"]): CaseProof {
    const verification = row.verifications[0];
    const transaction = row.transactions[0];
    const providerUnavailable = ["UNAVAILABLE", "NOT_FOUND"].includes(
      verification?.providerState ?? "",
    );
    const ledgerConfirmation = !row.binding?.providerTransactionId
      ? row.state === "SUBMITTED"
        ? "PENDING"
        : "NOT_SUBMITTED"
      : verification?.providerState === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : verification?.providerState === "NOT_FOUND"
          ? "NOT_FOUND"
          : verification
            ? verification.ledgerProofConfirmed
              ? "CONFIRMED"
              : "PENDING"
            : row.state === "CONFIRMED"
              ? "CONFIRMED"
              : "PENDING";
    const ledgerHash = !verification
      ? "NOT_RUN"
      : providerUnavailable
        ? "UNAVAILABLE"
        : verification.ledgerHashMatch
          ? "MATCH"
          : "MISMATCH";
    return caseProofSchema.parse({
      proofRequestId: row.id,
      proofId: row.proofId,
      proofType: row.kind,
      eligibility: "ANCHOR_REQUESTED",
      lifecycle: lifecycle(row.state),
      storedState: row.state,
      retryable: row.state === "FAILED_RETRYABLE",
      attemptCount: row.attempts,
      safeFailureCode: row.safeErrorCode ?? transaction?.safeErrorCode ?? null,
      evidenceId: row.evidenceAssetId,
      evidenceVersionId: row.evidenceVersionId,
      decisionId: row.decisionId,
      decisionOutcome: row.decisionRecord?.decisionOutcomeCode ?? null,
      previousProofId: row.evidenceRecord?.previousProofId ?? null,
      provider: {
        providerType: row.providerType,
        transactionId: row.binding?.providerTransactionId ?? null,
        proofReference: row.binding?.providerProofReference ?? null,
        contractReference: row.binding?.providerContractReference ?? null,
        networkReference: row.binding?.providerNetworkReference ?? null,
      },
      verification: {
        offLedgerHash: !verification
          ? "NOT_RUN"
          : verification.offLedgerHashMatch
            ? "MATCH"
            : "MISMATCH",
        ledgerConfirmation,
        ledgerHash,
        overallVerified:
          ledgerConfirmation === "CONFIRMED" && ledgerHash === "MATCH",
        providerState: verification?.providerState ?? null,
        safeErrorCode: verification?.safeErrorCode ?? null,
        verifiedAt: verification?.verifiedAt.toISOString() ?? null,
        requestedBy: verification?.requestedBy ?? null,
      },
      requestedAt: row.requestedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      finalizedAt:
        row.confirmedAt?.toISOString() ??
        transaction?.finalizedAt?.toISOString() ??
        null,
      requestedBy: row.requestedBy,
      history,
    });
  }

  private async optionalDecision(
    organizationId: string,
    caseId: string,
    correlationId: string,
  ) {
    try {
      return await this.dependencies.decisionSnapshot(
        organizationId,
        caseId,
        correlationId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  private storedStates(
    status: CaseProof["lifecycle"],
  ): Array<
    | "PENDING"
    | "SUBMITTING"
    | "SUBMITTED"
    | "CONFIRMED"
    | "FAILED_RETRYABLE"
    | "FAILED_PERMANENT"
    | "CONFLICT"
  > {
    if (status === "PENDING") return ["PENDING", "SUBMITTING"];
    if (status === "SUBMITTED") return ["SUBMITTED"];
    if (status === "CONFIRMED") return ["CONFIRMED"];
    return ["FAILED_RETRYABLE", "FAILED_PERMANENT", "CONFLICT"];
  }

  private filterHash(query: CaseProofListQuery) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          proofType: query.proofType ?? null,
          status: query.status ?? null,
          evidenceId: query.evidenceId ?? null,
          evidenceVersionId: query.evidenceVersionId ?? null,
          providerType: query.providerType ?? null,
          pageSize: query.pageSize,
        }),
      )
      .digest("hex");
  }

  private encodeCursor(value: Cursor) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signature = createHmac(
      "sha256",
      this.environment.INTERNAL_SERVICE_TOKEN,
    )
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  private decodeCursor(
    value: string,
    organizationId: string,
    caseId: string,
    filterHash: string,
  ) {
    try {
      const [payload, signature, extra] = value.split(".");
      if (!payload || !signature || extra) throw new Error("invalid");
      const expected = createHmac(
        "sha256",
        this.environment.INTERNAL_SERVICE_TOKEN,
      )
        .update(payload)
        .digest();
      const supplied = Buffer.from(signature, "base64url");
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        throw new Error("invalid");
      const cursor = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as Cursor;
      if (
        cursor.organizationId !== organizationId ||
        cursor.caseId !== caseId ||
        cursor.filterHash !== filterHash ||
        !cursor.id ||
        Number.isNaN(new Date(cursor.requestedAt).valueOf())
      )
        throw new Error("scope");
      return cursor;
    } catch {
      throw new BadRequestException(
        "The case proof cursor is invalid or does not match this query.",
      );
    }
  }

  private eventStatus(eventType: string) {
    if (eventType.includes("verification")) return "VERIFIED";
    if (eventType.includes("confirmed")) return "CONFIRMED";
    if (eventType.includes("submitted")) return "SUBMITTED";
    if (eventType.includes("failed")) return "FAILED";
    if (eventType.includes("retried")) return "RETRIED";
    return "REQUESTED";
  }
}
