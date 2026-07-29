import type { CaseLedgerSummary, CaseProof } from "@cdep/contracts";
import {
  CheckCircle2,
  CircleMinus,
  Clipboard,
  Fingerprint,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
<<<<<<< HEAD
import { CopyIdentifier } from "./ui";
=======
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d

type ProofLifecycle = CaseProof["lifecycle"] | null;
type ProofEligibility = CaseProof["eligibility"];

export function formatLedgerTimestamp(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Invalid timestamp";
  return `${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(parsed)} UTC`;
}

export function proofStatusPresentation(
  lifecycle: ProofLifecycle,
  eligibility?: ProofEligibility,
  retryable = false,
) {
  if (lifecycle === "CONFIRMED")
    return { label: "Confirmed", tone: "status-green", icon: "confirmed" };
  if (lifecycle === "FAILED")
    return {
      label: retryable ? "Failed — retry available" : "Failed — permanent",
      tone: "status-purple",
      icon: "failed",
    };
  if (lifecycle === "SUBMITTED")
    return { label: "Submitted", tone: "status-amber", icon: "pending" };
  if (lifecycle === "PENDING")
    return { label: "Anchor pending", tone: "status-amber", icon: "pending" };
  if (eligibility === "NOT_ELIGIBLE")
    return { label: "Not eligible", tone: "status-neutral", icon: "neutral" };
  if (eligibility === "ELIGIBLE_NOT_ANCHORED")
    return {
      label: "Eligible — not yet anchored",
      tone: "status-amber",
      icon: "pending",
    };
  return { label: "No proof found", tone: "status-neutral", icon: "neutral" };
}

export function ProofStatusBadge({
  lifecycle,
  eligibility,
  retryable = false,
}: {
  lifecycle: ProofLifecycle;
  eligibility?: ProofEligibility;
  retryable?: boolean;
}) {
  const status = proofStatusPresentation(lifecycle, eligibility, retryable);
  return (
    <span
      className={`status ${status.tone}`}
      aria-label={`Proof status: ${status.label}`}
    >
      {status.icon === "confirmed" ? (
        <CheckCircle2 size={12} />
      ) : status.icon === "failed" ? (
        <TriangleAlert size={12} />
      ) : status.icon === "neutral" ? (
        <CircleMinus size={12} aria-hidden="true" />
      ) : (
        <LoaderCircle size={12} aria-hidden="true" />
      )}
      {status.label}
    </span>
  );
}

export function TransactionReference({
  transactionId,
}: {
  transactionId: string;
}) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(transactionId);
      setFeedback("Transaction reference copied");
    } catch {
      setFeedback("Copy failed. Select the reference and copy it manually.");
    }
  }
  return (
    <span className="transaction-reference" title={transactionId}>
      <Link2 size={14} aria-hidden="true" />
      <span className="transaction-reference-value">
        {transactionId.slice(0, 14)}…
      </span>
      <button
        type="button"
        className="copy-reference"
        aria-label="Copy full transaction reference"
        onClick={() => void copy()}
      >
        <Clipboard size={13} />
      </button>
      <span className="copy-feedback" role="status" aria-live="polite">
        {feedback}
      </span>
    </span>
  );
}

export function ProofVerificationPanel({ proof }: { proof: CaseProof }) {
  const items = [
    ["Off-ledger hash", proof.verification.offLedgerHash],
    ["Ledger confirmation", proof.verification.ledgerConfirmation],
    ["Ledger hash", proof.verification.ledgerHash],
  ] as const;
  return (
    <div className="ledger-verification-grid" aria-label="Verification results">
      {items.map(([label, value]) => {
        const warning = ["MISMATCH", "NOT_FOUND", "UNAVAILABLE"].includes(
          value,
        );
        const success = ["MATCH", "CONFIRMED"].includes(value);
        return (
          <div key={label}>
            <span>{label}</span>
            <strong
              className={
                success
                  ? "verification-success"
                  : warning
                    ? "verification-warning"
                    : ""
              }
            >
              {success ? (
                <CheckCircle2 size={14} />
              ) : warning ? (
                <TriangleAlert size={14} />
              ) : (
                <LoaderCircle size={14} />
              )}
              {value.replaceAll("_", " ")}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export function AnchorProofButton({
  busy,
  label,
  disabled = false,
  disabledReason,
  onClick,
}: {
  busy: boolean;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  onClick(): void;
}) {
  const reason = busy
    ? "A ledger command is already in progress."
    : disabledReason;
  return (
    <span className="disabled-action">
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled}
        aria-label={reason ? `${label}: ${reason}` : label}
        onClick={onClick}
      >
        <Fingerprint size={16} /> {busy ? "Submitting…" : label}
      </button>
      {reason && <small>{reason}</small>}
    </span>
  );
}

export function LedgerAvailabilityNotice({
  summary,
}: {
  summary: CaseLedgerSummary | null;
}) {
  if (!summary || summary.ledgerAvailability.available) return null;
  return (
    <div className="api-problem" role="alert">
      Ledger temporarily unavailable. Existing proof records remain readable;
      anchoring, verification, and retry are disabled until the provider
      recovers.
    </div>
  );
}

export function ProofHistory({ proof }: { proof: CaseProof }) {
  return (
    <ol className="proof-history">
      {proof.history.length ? (
        proof.history.map((event) => (
          <li key={event.id}>
            <strong>{event.status.replaceAll("_", " ")}</strong>
            <span>{formatLedgerTimestamp(event.occurredAt)}</span>
            <small title={event.actorId}>
              Actor {event.actorId.slice(0, 8)}
            </small>
          </li>
        ))
      ) : (
        <li>
          <strong>REQUESTED</strong>
          <span>{formatLedgerTimestamp(proof.requestedAt)}</span>
        </li>
      )}
    </ol>
  );
}

export function DecisionProofSummary({
  summary,
  proof,
  canCreate,
  busy,
  disabled,
  onAnchor,
  onOpen,
}: {
  summary: CaseLedgerSummary["decision"];
  proof: CaseProof | null;
  canCreate: boolean;
  busy: boolean;
  disabled: boolean;
  onAnchor(): void;
  onOpen(proof: CaseProof): void;
}) {
  return (
    <section className="ledger-entity-card">
      <div className="ledger-decision-copy">
        <p className="eyebrow">Decision proof</p>
        <h3>{summary.decisionOutcome ?? "Decision not terminal"}</h3>
        <p>{summary.explanation}</p>
      </div>
      <div className="ledger-decision-actions">
        <ProofStatusBadge
          lifecycle={proof?.lifecycle ?? null}
          eligibility={summary.eligibility}
          retryable={proof?.retryable}
        />
        {proof ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => onOpen(proof)}
          >
            View proof
          </button>
        ) : canCreate && summary.eligibility === "ELIGIBLE_NOT_ANCHORED" ? (
          <AnchorProofButton
            busy={busy}
            disabled={disabled}
            disabledReason={
              disabled
                ? "The configured ledger provider is unavailable."
                : undefined
            }
            label="Anchor decision"
            onClick={onAnchor}
          />
        ) : null}
      </div>
    </section>
  );
}

export function EvidenceProofStatus({
  lifecycle,
  eligibility,
  retryable,
  onOpen,
}: {
  lifecycle: ProofLifecycle;
  eligibility?: ProofEligibility;
  retryable?: boolean;
  onOpen?(): void;
}) {
  const badge = (
    <ProofStatusBadge
      lifecycle={lifecycle}
      eligibility={eligibility}
      retryable={retryable}
    />
  );
  return onOpen ? (
    <button type="button" className="proof-status-link" onClick={onOpen}>
      {badge}
    </button>
  ) : (
    badge
  );
}

function useModalFocus(
  open: boolean,
  container: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const previous = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || !container.current) return;
    previous.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const root = container.current;
    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    focusable()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", handle);
    return () => {
      root.removeEventListener("keydown", handle);
      previous.current?.focus();
    };
  }, [open, container]);
}

export function ProofDetailsDrawer({
  proof,
  canVerify,
  canRetry,
  busy,
  disabled,
  onClose,
  onVerify,
  onRetry,
  transactionDetails,
}: {
  proof: CaseProof | null;
  canVerify: boolean;
  canRetry: boolean;
  busy: boolean;
  disabled: boolean;
  onClose(): void;
  onVerify(proof: CaseProof): void;
  onRetry(proof: CaseProof): void;
  transactionDetails?: React.ReactNode;
}) {
  const drawer = useRef<HTMLElement>(null);
  useModalFocus(Boolean(proof), drawer, onClose);
  if (!proof) return null;
  return (
    <div className="proof-drawer-layer">
      <button
        type="button"
        className="proof-drawer-backdrop"
        onClick={onClose}
        aria-label="Dismiss proof details"
      />
      <aside
        ref={drawer}
        className="proof-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proof-drawer-title"
      >
        <header>
          <div>
            <p className="eyebrow">{proof.proofType} proof</p>
            <h2 id="proof-drawer-title">Proof details</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close proof details"
          >
            <X size={18} />
          </button>
        </header>
        <ProofStatusBadge
          lifecycle={proof.lifecycle}
          eligibility={proof.eligibility}
          retryable={proof.retryable}
        />
<<<<<<< HEAD
        <div className="proof-assurance-banner">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Confirmed ledger record</strong>
            <span>
              References below are shown exactly as they were returned by the
              ledger provider.
            </span>
          </div>
        </div>
        <dl className="proof-reference-list">
          <dt>Proof ID</dt>
          <dd>
            <CopyIdentifier value={proof.proofId} />
          </dd>
          <dt>Provider</dt>
          <dd>{proof.provider.providerType}</dd>
          <dt>Network</dt>
          <dd>
            {proof.provider.networkReference ? (
              <CopyIdentifier value={proof.provider.networkReference} />
            ) : (
              "Pending"
            )}
          </dd>
          <dt>Contract</dt>
          <dd>
            {proof.provider.contractReference ? (
              <CopyIdentifier value={proof.provider.contractReference} />
            ) : (
              "Pending"
            )}
          </dd>
=======
        <dl className="proof-reference-list">
          <dt>Proof ID</dt>
          <dd>{proof.proofId}</dd>
          <dt>Provider</dt>
          <dd>{proof.provider.providerType}</dd>
          <dt>Network</dt>
          <dd>{proof.provider.networkReference ?? "Pending"}</dd>
          <dt>Contract</dt>
          <dd>{proof.provider.contractReference ?? "Pending"}</dd>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          <dt>Requested</dt>
          <dd>{formatLedgerTimestamp(proof.requestedAt)}</dd>
          <dt>Finalized</dt>
          <dd>{formatLedgerTimestamp(proof.finalizedAt)}</dd>
        </dl>
        {proof.provider.transactionId && (
          <TransactionReference transactionId={proof.provider.transactionId} />
        )}
        {transactionDetails}
        <ProofVerificationPanel proof={proof} />
        <div className="ledger-proof-actions">
          {canVerify && proof.lifecycle === "CONFIRMED" && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || disabled}
              title={disabled ? "Ledger temporarily unavailable" : undefined}
              onClick={() => onVerify(proof)}
            >
              <ShieldCheck size={16} /> Verify proof
            </button>
          )}
          {canRetry && proof.retryable && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || disabled}
              title={disabled ? "Ledger temporarily unavailable" : undefined}
              onClick={() => onRetry(proof)}
            >
              <RefreshCw size={16} /> Retry safely
            </button>
          )}
        </div>
        {proof.safeFailureCode && (
          <div className="api-problem">
<<<<<<< HEAD
            Failure code: {proof.safeFailureCode}
=======
            Safe failure code: {proof.safeFailureCode}
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </div>
        )}
        <h3>Proof history</h3>
        <ProofHistory proof={proof} />
      </aside>
    </div>
  );
}

export function RetryProofDialog({
  proof,
  busy,
  onCancel,
  onConfirm,
}: {
  proof: CaseProof | null;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(Boolean(proof), dialog, onCancel);
  if (!proof) return null;
  return (
    <div className="modal-layer">
      <button
        type="button"
        className="modal-backdrop"
        onClick={onCancel}
        aria-label="Cancel proof retry"
      />
      <section
        ref={dialog}
        className="modal-card retry-proof-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="retry-proof-title"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Recoverable proof failure</p>
            <h2 id="retry-proof-title">Retry ledger proof?</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="Cancel proof retry"
          >
            <X size={18} />
          </button>
        </div>
        <div className="retry-proof-body">
          <p>
<<<<<<< HEAD
            Retry sends the same saved proof request again. It will not create a
            duplicate proof or change a confirmed ledger record.
=======
            Retry reuses the stored canonical proof envelope. It does not create
            a second canonical proof or alter confirmed provider data.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "Retrying…" : "Confirm retry"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
