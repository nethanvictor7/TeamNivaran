import {
  caseLedgerSummarySchema,
  caseProofListResponseSchema,
  ledgerTransactionSchema,
  type CaseLedgerSummary as CaseLedgerSummaryData,
  type CaseProof,
  type CaseProofListResponse,
} from "@cdep/contracts";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
<<<<<<< HEAD
import {
  Blocks,
  CheckCircle2,
  Clock3,
  Fingerprint,
  Network,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
=======
import { Fingerprint, RefreshCw, ShieldCheck } from "lucide-react";
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
import { useRef, useState } from "react";
import type { ZodType } from "zod";
import { useAuth } from "./auth";
import {
  AnchorProofButton,
  DecisionProofSummary,
  EvidenceProofStatus,
  LedgerAvailabilityNotice,
  ProofDetailsDrawer,
  ProofStatusBadge,
  RetryProofDialog,
  formatLedgerTimestamp,
} from "./LedgerProofs";
import { CopyIdentifier, SelectField } from "./ui";

class LedgerRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly correlationId?: string,
  ) {
    super(message);
  }
}

function parseLedgerResponse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new LedgerRequestError(
      "The ledger response could not be read safely. Refresh or contact support.",
      undefined,
      "LEDGER_RESPONSE_CONTRACT_MISMATCH",
    );
  return parsed.data;
}

async function issue(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const correlationId =
    typeof body.correlationId === "string"
      ? body.correlationId
      : (response.headers.get("x-correlation-id") ?? undefined);
  const detail =
    typeof body.detail === "string"
      ? body.detail
      : `Ledger request failed (${response.status}).`;
  return new LedgerRequestError(
    correlationId ? `${detail} Correlation: ${correlationId}` : detail,
    response.status,
    typeof body.code === "string" ? body.code : undefined,
    correlationId,
  );
}

export type CaseLedgerController = {
  caseId: string;
  summary: CaseLedgerSummaryData | null;
  proofs: CaseProof[];
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  partial: boolean;
  error: string;
  busy: boolean;
  hasNextPage: boolean;
  canCreate: boolean;
  canVerify: boolean;
  canRetry: boolean;
  refresh(): Promise<void>;
  fetchNext(): Promise<void>;
  anchorEvidence(evidenceId: string, versionId: string): Promise<boolean>;
  anchorDecision(): Promise<boolean>;
  verify(proof: CaseProof): Promise<boolean>;
  requestRetry(proof: CaseProof): void;
  retryProof: CaseProof | null;
  cancelRetry(): void;
  confirmRetry(): Promise<boolean>;
};

export function ledgerPollInterval(
  active: boolean,
  unsettled: boolean,
  startedAt: number,
  failureCount: number,
  now = Date.now(),
) {
  if (!active || !unsettled || now - startedAt >= 120_000) return false;
  return Math.min(8_000, 1_000 * 2 ** Math.min(failureCount, 3));
}

export function useCaseLedger(
  caseId: string,
  summaryEnabled: boolean,
  proofsEnabled: boolean,
  active: boolean,
): CaseLedgerController {
  const auth = useAuth();
  const client = useQueryClient();
  const polling = useRef({ caseId, startedAt: Date.now() });
  if (polling.current.caseId !== caseId)
    polling.current = { caseId, startedAt: Date.now() };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryProof, setRetryProof] = useState<CaseProof | null>(null);
  const summary = useQuery({
    queryKey: ["case-ledger-summary", caseId],
    queryFn: async ({ signal }) => {
      const response = await auth.request(
        `/api/v1/cases/${caseId}/ledger-summary`,
        { signal },
      );
      if (!response.ok) throw await issue(response);
      return parseLedgerResponse(
        caseLedgerSummarySchema,
        await response.json(),
      );
    },
    enabled: summaryEnabled,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return ledgerPollInterval(
        active,
        state === "ANCHORING",
        polling.current.startedAt,
        query.state.fetchFailureCount,
      );
    },
  });
  const proofs = useInfiniteQuery({
    queryKey: ["case-ledger-proofs", caseId],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ pageSize: "25" });
      if (pageParam) params.set("cursor", pageParam);
      const response = await auth.request(
        `/api/v1/cases/${caseId}/proofs?${params}`,
        { signal },
      );
      if (!response.ok) throw await issue(response);
      return parseLedgerResponse(
        caseProofListResponseSchema,
        await response.json(),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: proofsEnabled,
    refetchInterval: (query) => {
      const rows = query.state.data?.pages.flatMap((page) => page.items) ?? [];
      const unsettled = rows.some((proof) =>
        ["PENDING", "SUBMITTED"].includes(proof.lifecycle),
      );
      return ledgerPollInterval(
        active,
        unsettled,
        polling.current.startedAt,
        query.state.fetchFailureCount,
      );
    },
  });

  async function refresh() {
    polling.current.startedAt = Date.now();
    await Promise.all([
      summaryEnabled ? summary.refetch() : Promise.resolve(),
      proofsEnabled ? proofs.refetch() : Promise.resolve(),
    ]);
  }

  async function act(path: string, init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const response = await auth.request(path, init);
      if (!response.ok) throw await issue(response);
      polling.current.startedAt = Date.now();
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["case-ledger-summary", caseId],
        }),
        client.invalidateQueries({
          queryKey: ["case-ledger-proofs", caseId],
        }),
        client.invalidateQueries({
          queryKey: ["case-ledger-proofs-filtered", caseId],
        }),
        client.invalidateQueries({ queryKey: ["case-evidence", caseId] }),
        client.invalidateQueries({ queryKey: ["case-workflow", caseId] }),
        client.invalidateQueries({ queryKey: ["case-timeline", caseId] }),
        client.invalidateQueries({ queryKey: ["case", caseId] }),
      ]);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Ledger action failed.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  const identity = auth.identity;
  const allProofs = proofs.data?.pages.flatMap((page) => page.items) ?? [];
  return {
    caseId,
    summary: summary.data ?? null,
    proofs: allProofs,
    loading: summary.isLoading || proofs.isLoading,
    refreshing: summary.isFetching || proofs.isFetching,
    stale: summary.data
      ? Date.parse(summary.data.freshness.staleAfter) < Date.now()
      : false,
    partial:
      summaryEnabled &&
      proofsEnabled &&
      Boolean(summary.data) !== Boolean(proofs.data),
    error:
      error ||
      (summary.error instanceof Error
        ? summary.error.message
        : proofs.error instanceof Error
          ? proofs.error.message
          : ""),
    busy,
    hasNextPage: proofs.hasNextPage,
    canCreate: Boolean(identity?.permissions.includes("proof:create")),
    canVerify: Boolean(identity?.permissions.includes("proof:verify")),
    canRetry: Boolean(identity?.permissions.includes("proof:retry")),
    refresh,
    async fetchNext() {
      await proofs.fetchNextPage();
    },
    async anchorEvidence(evidenceId, versionId) {
      return act(
        `/api/v1/evidence/${evidenceId}/versions/${versionId}/proofs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: "{}",
        },
      );
    },
    async anchorDecision() {
      return act(`/api/v1/cases/${caseId}/decision-proof`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: "{}",
      });
    },
    async verify(proof) {
      const path =
        proof.proofType === "DECISION"
          ? `/api/v1/cases/${caseId}/decision-proof/verify`
          : `/api/v1/evidence/${proof.evidenceId}/versions/${proof.evidenceVersionId}/proofs/verify`;
      return act(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    },
    requestRetry: setRetryProof,
    retryProof,
    cancelRetry() {
      setRetryProof(null);
    },
    async confirmRetry() {
      if (!retryProof) return false;
      const succeeded = await act(
        `/api/v1/ledger/proofs/${retryProof.proofRequestId}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      if (succeeded) setRetryProof(null);
      return succeeded;
    },
  };
}

export function CaseLedgerSummary({
  ledger,
  onOpen,
}: {
  ledger: CaseLedgerController;
  onOpen(): void;
}) {
  const summary = ledger.summary;
  return (
    <section className="ledger-summary-card">
      <div>
        <p className="eyebrow">Ledger & verification</p>
        <h3>{summary?.state.replaceAll("_", " ") ?? "Loading ledger state"}</h3>
        <p>
          {summary
            ? `${summary.evidenceCounts.confirmed} of ${summary.evidenceCounts.eligible} current Evidence Versions confirmed`
<<<<<<< HEAD
            : "Loading proof status…"}
=======
            : "Reading the case-scoped proof projection…"}
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
        </p>
      </div>
      <div className="case-panel-actions">
        {summary?.latestVerification?.overallVerified && (
          <span className="status status-green">
            <ShieldCheck size={13} /> Latest verified
          </span>
        )}
        <button className="secondary-button" onClick={onOpen}>
          <Fingerprint size={16} /> Open ledger
        </button>
      </div>
    </section>
  );
}

<<<<<<< HEAD
function LedgerTrustStrip({ summary }: { summary: CaseLedgerSummaryData }) {
  const network =
    summary.latestConfirmed?.provider.networkReference ?? "Not bound";
  const items = [
    {
      label: "Case proof",
      value: summary.state.replaceAll("_", " "),
      icon: ShieldCheck,
      healthy: !["FAILED", "MISMATCH"].includes(summary.state),
    },
    {
      label: "Evidence coverage",
      value: `${summary.evidenceCounts.confirmed}/${summary.evidenceCounts.eligible} confirmed`,
      icon: CheckCircle2,
      healthy:
        summary.evidenceCounts.eligible > 0 &&
        summary.evidenceCounts.confirmed === summary.evidenceCounts.eligible,
    },
    {
      label: "Provider",
      value: summary.ledgerAvailability.providerType,
      icon: Blocks,
      healthy: summary.ledgerAvailability.available,
    },
    {
      label: "Network / channel",
      value: network,
      icon: Network,
      healthy: network !== "Not bound",
    },
    {
      label: "Fresh as of",
      value: formatLedgerTimestamp(summary.freshness.generatedAt),
      icon: Clock3,
      healthy: Date.parse(summary.freshness.staleAfter) >= Date.now(),
    },
  ];
  return (
    <section className="ledger-trust-strip" aria-label="Ledger trust status">
      {items.map(({ label, value, icon: Icon, healthy }) => (
        <div
          key={label}
          className={
            healthy ? "ledger-trust-positive" : "ledger-trust-attention"
          }
        >
          <span className="ledger-trust-icon" aria-hidden="true">
            <Icon size={19} />
          </span>
          <span>
            <small>{label}</small>
            <strong>{value}</strong>
          </span>
        </div>
      ))}
    </section>
  );
}

function IndependentVerification({
  summary,
  canVerify,
  busy,
  onVerify,
}: {
  summary: CaseLedgerSummaryData;
  canVerify: boolean;
  busy: boolean;
  onVerify(proof: CaseProof): void;
}) {
  const verification = summary.latestVerification;
  const latest = summary.latestConfirmed;
  const checks = verification
    ? [
        {
          label: "Transaction finalized",
          value: verification.providerState === "FINALIZED",
        },
        {
          label: "Transaction exists on ledger",
          value: verification.ledgerConfirmation === "CONFIRMED",
        },
        {
          label: "Off-ledger content hash matches",
          value: verification.offLedgerHash === "MATCH",
        },
        {
          label: "Anchored ledger hash matches",
          value: verification.ledgerHash === "MATCH",
        },
      ]
    : [];
  return (
    <aside className="ledger-assurance-card">
      <div className="ledger-assurance-heading">
        <span className="ledger-assurance-icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <div>
          <p className="eyebrow">Independent verification</p>
          <h3>Proof checks</h3>
          <p>
            These checks compare the stored evidence with the confirmed ledger
            record.
          </p>
        </div>
      </div>
      {verification ? (
        <>
          <ul className="ledger-assurance-list">
            {checks.map((check) => (
              <li key={check.label}>
                {check.value ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <TriangleAlert size={16} aria-hidden="true" />
                )}
                <span>{check.label}</span>
                <strong>{check.value ? "Pass" : "Attention"}</strong>
              </li>
            ))}
          </ul>
          <div className="ledger-assurance-footer">
            <span>
              Last verified
              <strong>{formatLedgerTimestamp(verification.verifiedAt)}</strong>
            </span>
            {canVerify && latest && (
              <button
                type="button"
                className="primary-button"
                disabled={busy || !summary.ledgerAvailability.available}
                onClick={() => onVerify(latest)}
              >
                <RefreshCw size={16} />
                {busy ? "Verifying…" : "Verify latest proof"}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="ledger-assurance-empty">
          <TriangleAlert size={18} aria-hidden="true" />
          No independent verification has been recorded for the latest proof.
        </div>
      )}
    </aside>
  );
}

=======
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
export function CaseLedgerTab({ ledger }: { ledger: CaseLedgerController }) {
  const auth = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proofType, setProofType] = useState("");
  const [status, setStatus] = useState("");
  const summary = ledger.summary;
  const filtersActive = Boolean(proofType || status);
  const filteredQuery = useInfiniteQuery({
    queryKey: ["case-ledger-proofs-filtered", ledger.caseId, proofType, status],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ pageSize: "25" });
      if (proofType) params.set("proofType", proofType);
      if (status) params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      const response = await auth.request(
        `/api/v1/cases/${ledger.caseId}/proofs?${params}`,
        { signal },
      );
      if (!response.ok) throw await issue(response);
      return parseLedgerResponse(
        caseProofListResponseSchema,
        await response.json(),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: filtersActive,
  });
  const filtered = filtersActive
    ? (filteredQuery.data?.pages.flatMap((page) => page.items) ?? [])
    : ledger.proofs;
  const selected =
    [...ledger.proofs, ...filtered].find(
      (proof) => proof.proofRequestId === selectedId,
    ) ?? null;
  const decisionProof =
    ledger.proofs.find((proof) => proof.proofType === "DECISION") ?? null;
  const byVersion = new Map(
    ledger.proofs
      .filter((proof) => proof.evidenceVersionId)
      .map((proof) => [proof.evidenceVersionId!, proof]),
  );
  return (
    <section className="card case-page-panel case-ledger-tab">
      <div className="case-panel-header">
        <div>
<<<<<<< HEAD
          <p className="eyebrow">Case proof</p>
          <h2>Ledger & verification</h2>
          <p>
            Confirm evidence and final decisions on the ledger, then verify that
            each proof still matches the case record.
=======
          <p className="eyebrow">Provider-neutral proof view</p>
          <h2>Ledger & Verification</h2>
          <p>
            Case-level anchoring, provider references, lifecycle, and
            independent verification results.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={ledger.loading || ledger.refreshing}
          onClick={() => void ledger.refresh()}
        >
          <RefreshCw size={16} />{" "}
          {ledger.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {ledger.error && (
        <div className="api-problem" role="alert">
          {ledger.error}
        </div>
      )}
      {ledger.partial && (
        <div className="api-warning" role="status">
<<<<<<< HEAD
          Some ledger information could not be loaded. Refresh to try again.
=======
          Partial ledger data is available. Refresh to recover the missing
          projection.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
        </div>
      )}
      {ledger.stale && (
        <div className="api-warning" role="status">
<<<<<<< HEAD
          This ledger information may be out of date. The last verified data is
          shown while Aegis refreshes it.
=======
          The last trustworthy ledger projection is stale. Displayed proof data
          is retained while a refresh is attempted.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
        </div>
      )}
      <LedgerAvailabilityNotice summary={summary} />
      {ledger.loading && !summary && (
        <div className="empty-state" role="status">
          Loading ledger summary and proof history…
        </div>
      )}
      {summary && (
        <>
<<<<<<< HEAD
          <LedgerTrustStrip summary={summary} />
=======
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          <div className="ledger-metric-grid">
            <div>
              <span>Case proof state</span>
              <strong>{summary.state.replaceAll("_", " ")}</strong>
            </div>
            <div>
              <span>Confirmed evidence</span>
              <strong>
                {summary.evidenceCounts.confirmed}/
                {summary.evidenceCounts.eligible}
              </strong>
            </div>
            <div>
              <span>Provider</span>
              <strong>{summary.ledgerAvailability.providerType}</strong>
            </div>
            <div>
              <span>Fresh at</span>
              <strong>
                {formatLedgerTimestamp(summary.freshness.generatedAt)}
              </strong>
            </div>
          </div>
          <DecisionProofSummary
            summary={summary.decision}
            proof={decisionProof}
            canCreate={ledger.canCreate}
            busy={ledger.busy}
            disabled={!summary.ledgerAvailability.available}
            onAnchor={() => void ledger.anchorDecision()}
            onOpen={(proof) => setSelectedId(proof.proofRequestId)}
          />
<<<<<<< HEAD
          <IndependentVerification
            summary={summary}
            canVerify={ledger.canVerify}
            busy={ledger.busy}
            onVerify={(proof) => void ledger.verify(proof)}
          />
          <section className="ledger-evidence-section">
            <div className="evidence-section-heading">
              <div>
                <h3>Current evidence versions</h3>
                <p>
                  See which evidence versions have a confirmed ledger proof.
                </p>
=======
          <section>
            <div className="evidence-section-heading">
              <div>
                <h3>Current Evidence Versions</h3>
                <p>One case-scoped projection; no per-row ledger requests.</p>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
              </div>
            </div>
            <div className="ledger-evidence-grid">
              {summary.evidenceTargets.map((target) => {
                const proof = byVersion.get(target.evidenceVersionId);
                return (
<<<<<<< HEAD
                  <article
                    className="ledger-evidence-row"
                    key={target.evidenceVersionId}
                  >
                    <div className="ledger-evidence-identity">
=======
                  <article key={target.evidenceVersionId}>
                    <div>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                      <strong>{target.classificationCode}</strong>
                      <CopyIdentifier
                        value={target.evidenceVersionId}
                        prefix="Version"
                      />
                    </div>
<<<<<<< HEAD
                    <div className="ledger-evidence-actions">
                      <EvidenceProofStatus
                        lifecycle={target.lifecycle}
                        eligibility={target.eligibility}
                        retryable={proof?.retryable}
                        onOpen={
                          proof
                            ? () => setSelectedId(proof.proofRequestId)
                            : undefined
                        }
                      />
                      {!proof && ledger.canCreate && (
                        <AnchorProofButton
                          busy={ledger.busy}
                          disabled={!summary.ledgerAvailability.available}
                          disabledReason={
                            !summary.ledgerAvailability.available
                              ? "The configured ledger provider is unavailable."
                              : undefined
                          }
                          label="Anchor"
                          onClick={() =>
                            void ledger.anchorEvidence(
                              target.evidenceId,
                              target.evidenceVersionId,
                            )
                          }
                        />
                      )}
                    </div>
=======
                    <EvidenceProofStatus
                      lifecycle={target.lifecycle}
                      eligibility={target.eligibility}
                      retryable={proof?.retryable}
                      onOpen={
                        proof
                          ? () => setSelectedId(proof.proofRequestId)
                          : undefined
                      }
                    />
                    {!proof && ledger.canCreate && (
                      <AnchorProofButton
                        busy={ledger.busy}
                        disabled={!summary.ledgerAvailability.available}
                        disabledReason={
                          !summary.ledgerAvailability.available
                            ? "The configured ledger provider is unavailable."
                            : undefined
                        }
                        label="Anchor"
                        onClick={() =>
                          void ledger.anchorEvidence(
                            target.evidenceId,
                            target.evidenceVersionId,
                          )
                        }
                      />
                    )}
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                  </article>
                );
              })}
              {!summary.evidenceTargets.length && (
                <div className="empty-state">
<<<<<<< HEAD
                  No evidence version is ready to anchor.
=======
                  No available Evidence Version is eligible for anchoring.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                </div>
              )}
            </div>
          </section>
        </>
      )}
<<<<<<< HEAD
      <section className="ledger-history-section">
        <div className="evidence-section-heading">
          <div>
            <h3>Proof history</h3>
            <p>All proof requests for this case, newest first.</p>
=======
      <section>
        <div className="evidence-section-heading">
          <div>
            <h3>Proof history</h3>
            <p>Stable newest-first proof requests for this case.</p>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </div>
          <div className="ledger-filters" aria-label="Proof history filters">
            <SelectField
              label="Proof type"
              value={proofType}
              onChange={(event) => setProofType(event.target.value)}
            >
              <option value="">All proof types</option>
              <option value="EVIDENCE">Evidence</option>
              <option value="DECISION">Decision</option>
            </SelectField>
            <SelectField
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option>PENDING</option>
              <option>SUBMITTED</option>
              <option>CONFIRMED</option>
              <option>FAILED</option>
            </SelectField>
          </div>
        </div>
<<<<<<< HEAD
        <div className="proof-history-head" aria-hidden="true">
          <span>Proof type</span>
          <span>Requested at (UTC)</span>
          <span>Status</span>
          <span>Provider</span>
          <span>Action</span>
        </div>
=======
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
        <div className="proof-list">
          {filtered.map((proof) => (
            <button
              type="button"
              key={proof.proofRequestId}
              className="proof-history-row"
              onClick={() => setSelectedId(proof.proofRequestId)}
            >
              <span className="proof-history-type">
                <strong>{proof.proofType} proof</strong>
              </span>
              <span className="proof-history-time">
                {formatLedgerTimestamp(proof.requestedAt)}
              </span>
              <ProofStatusBadge
                lifecycle={proof.lifecycle}
                eligibility={proof.eligibility}
                retryable={proof.retryable}
              />
              <span className="proof-history-provider">
                {proof.provider.providerType}
              </span>
              <span className="proof-history-action">View details</span>
            </button>
          ))}
          {!ledger.loading && !filteredQuery.isLoading && !filtered.length && (
            <div className="empty-state">
              No proof history matches the filter.
            </div>
          )}
        </div>
        {filteredQuery.isError && (
          <div className="api-problem" role="alert">
            {filteredQuery.error instanceof Error
              ? filteredQuery.error.message
              : "Filtered proof history could not be loaded."}
          </div>
        )}
        {(filtersActive ? filteredQuery.hasNextPage : ledger.hasNextPage) && (
          <button
            type="button"
            className="secondary-button"
            disabled={filteredQuery.isFetchingNextPage}
            onClick={() =>
              void (filtersActive
                ? filteredQuery.fetchNextPage()
                : ledger.fetchNext())
            }
          >
            {filteredQuery.isFetchingNextPage
              ? "Loading…"
              : "Load older proofs"}
          </button>
        )}
      </section>
      <ProofDetailsDrawer
        proof={selected}
        canVerify={ledger.canVerify}
        canRetry={ledger.canRetry}
        busy={ledger.busy}
        disabled={!summary?.ledgerAvailability.available}
        onClose={() => setSelectedId(null)}
        onVerify={(proof) => void ledger.verify(proof)}
        onRetry={ledger.requestRetry}
        transactionDetails={<TransactionDetails proof={selected} />}
      />
      <RetryProofDialog
        proof={ledger.retryProof}
        busy={ledger.busy}
        onCancel={ledger.cancelRetry}
        onConfirm={() => void ledger.confirmRetry()}
      />
    </section>
  );
}

function TransactionDetails({ proof }: { proof: CaseProof | null }) {
  const auth = useAuth();
  const transactionId = proof?.provider.transactionId ?? null;
  const transaction = useQuery({
    queryKey: ["ledger-transaction", transactionId],
    queryFn: async ({ signal }) => {
      const response = await auth.request(
        `/api/v1/ledger/transactions/${encodeURIComponent(transactionId!)}`,
        { signal },
      );
      if (!response.ok) throw await issue(response);
      return parseLedgerResponse(
        ledgerTransactionSchema,
        await response.json(),
      );
    },
    enabled: Boolean(transactionId),
  });
  if (!transactionId) return null;
  if (transaction.isLoading)
    return (
      <div className="transaction-detail-state" role="status">
<<<<<<< HEAD
        Loading transaction details…
=======
        Loading authoritative transaction state…
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
      </div>
    );
  if (transaction.isError)
    return (
      <div className="api-problem" role="alert">
        {transaction.error instanceof Error
          ? transaction.error.message
          : "Transaction details could not be loaded."}
      </div>
    );
  return (
    <dl className="proof-reference-list transaction-details">
      <dt>Transaction state</dt>
      <dd>{transaction.data?.state.replaceAll("_", " ")}</dd>
      <dt>Bound provider</dt>
      <dd>{transaction.data?.providerType}</dd>
    </dl>
  );
}

export function LedgerActivity({ ledger }: { ledger: CaseLedgerController }) {
  const events = ledger.proofs
    .flatMap((proof) =>
      proof.history.map((event) => ({
        ...event,
        proofType: proof.proofType,
      })),
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 8);
  if (!events.length) return null;
  return (
    <div className="detail-section">
      <h3>Ledger activity</h3>
      {events.map((event) => (
        <div className="control-row" key={event.id}>
          <span>{formatLedgerTimestamp(event.occurredAt)}</span>
          <strong>
            {event.proofType} · {event.status.replaceAll("_", " ")}
          </strong>
        </div>
      ))}
    </div>
  );
}
