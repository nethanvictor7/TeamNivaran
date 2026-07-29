export type ProviderNormalizedState =
  | "ACCEPTED"
  | "PENDING_FINALITY"
  | "FINALIZED"
  | "REJECTED"
  | "NOT_FOUND"
  | "UNAVAILABLE";

export type ProviderNeutralProofEnvelope =
  | {
      kind: "EVIDENCE";
      schemaVersion: "1.0";
      proofId: string;
      organizationScopeHash: string;
      caseReferenceHash: string;
      evidenceId: string;
      evidenceVersionId: string;
      contentSha256: string;
      metadataSha256: string;
      previousProofId: string | null;
    }
  | {
      kind: "DECISION";
      schemaVersion: "1.0";
      proofId: string;
      caseReferenceHash: string;
      workflowInstanceId: string;
      decisionId: string;
      decisionOutcomeCode: "APPROVED" | "REJECTED";
      evidenceManifestSha256: string;
      recommendationSha256: string;
      decisionRecordSha256: string;
    };

export type ProviderSubmission = {
  state: ProviderNormalizedState;
  providerTransactionId: string;
  providerProofReference: string;
  providerContractReference: string;
  providerNetworkReference: string;
  providerMetadataSchemaVersion: "1.0";
  providerMetadata: {
    commitStatus: "VALID" | "UNKNOWN";
  };
  anchoredAt: string;
};

export type ProviderProofRecord = {
  proofId: string;
  kind: "EVIDENCE" | "DECISION";
  schemaVersion: "1.0";
  anchoredAt: string;
  transactionId: string;
  payload: ProviderNeutralProofEnvelope;
};

export type ProviderVerificationResult = {
  state: ProviderNormalizedState;
  proofConfirmed: boolean;
  hashMatch: boolean;
  anchoredAt?: string;
  providerTransactionId?: string;
};

export interface LedgerProvider {
  readonly providerType: "FABRIC" | "GCUL";
  getHealth(): Promise<{
    state: "AVAILABLE" | "UNAVAILABLE";
    providerType: "FABRIC" | "GCUL";
    networkReference: string;
    contractReference: string;
  }>;
  submitProof(request: {
    envelope: ProviderNeutralProofEnvelope;
    canonicalBytes: string;
    idempotencyKey: string;
  }): Promise<ProviderSubmission>;
  getTransaction(reference: {
    providerTransactionId: string;
    providerProofReference: string;
  }): Promise<{
    state: ProviderNormalizedState;
    providerTransactionId: string;
  }>;
  queryProof(proofId: string): Promise<ProviderProofRecord | null>;
  verifyProof(request: {
    proofId: string;
    expectedHashes: string[];
  }): Promise<ProviderVerificationResult>;
  close(): void;
}

export class LedgerProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly conflict = false,
  ) {
    super(code);
  }
}

export class MockLedgerProvider implements LedgerProvider {
  readonly providerType = "FABRIC" as const;
  private readonly records = new Map<string, ProviderProofRecord>();

  async getHealth() {
    return {
      state: "AVAILABLE" as const,
      providerType: this.providerType,
      networkReference: "mock-network",
      contractReference: "mock-contract",
    };
  }
  async submitProof(request: {
    envelope: ProviderNeutralProofEnvelope;
    canonicalBytes: string;
    idempotencyKey: string;
  }) {
    const existing = this.records.get(request.envelope.proofId);
    if (
      existing &&
      JSON.stringify(existing.payload) !== JSON.stringify(request.envelope)
    )
      throw new LedgerProviderError("PROOF_ID_CONFLICT", false, true);
    const transactionId = `mock-${request.envelope.proofId}`;
    const anchoredAt = "2026-01-01T00:00:00.000Z";
    this.records.set(request.envelope.proofId, {
      proofId: request.envelope.proofId,
      kind: request.envelope.kind,
      schemaVersion: "1.0",
      anchoredAt,
      transactionId,
      payload: request.envelope,
    });
    return {
      state: "FINALIZED" as const,
      providerTransactionId: transactionId,
      providerProofReference: request.envelope.proofId,
      providerContractReference: "mock-contract",
      providerNetworkReference: "mock-network",
      providerMetadataSchemaVersion: "1.0" as const,
      providerMetadata: { commitStatus: "VALID" as const },
      anchoredAt,
    };
  }
  async getTransaction(reference: {
    providerTransactionId: string;
    providerProofReference: string;
  }) {
    return {
      state: this.records.has(reference.providerProofReference)
        ? ("FINALIZED" as const)
        : ("NOT_FOUND" as const),
      providerTransactionId: reference.providerTransactionId,
    };
  }
  async queryProof(proofId: string) {
    return this.records.get(proofId) ?? null;
  }
  async verifyProof(request: { proofId: string; expectedHashes: string[] }) {
    const record = this.records.get(request.proofId);
    if (!record)
      return {
        state: "NOT_FOUND" as const,
        proofConfirmed: false,
        hashMatch: false,
      };
    const values = JSON.stringify(record.payload);
    return {
      state: "FINALIZED" as const,
      proofConfirmed: true,
      hashMatch: request.expectedHashes.every((hash) => values.includes(hash)),
      anchoredAt: record.anchoredAt,
      providerTransactionId: record.transactionId,
    };
  }
  close() {}
}
