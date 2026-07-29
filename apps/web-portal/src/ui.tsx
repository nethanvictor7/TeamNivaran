import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Info,
  MinusCircle,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "cancelled"
  | "superseded"
  | "disabled";

export function statusPresentation(value: string): {
  label: string;
  tone: StatusTone;
} {
  const normalized = value.toUpperCase();
  const label = normalized.replaceAll("_", " ");
  if (
    [
      "SUCCEEDED",
      "CONFIRMED",
      "VERIFIED",
      "APPROVED",
      "ACTIVE",
      "ENABLED",
      "AVAILABLE",
      "LOW",
      "NORMAL",
      "DECIDED",
      "CLOSED",
    ].includes(normalized)
  )
    return { label, tone: "success" };
  if (
    ["FAILED", "INVALID_OUTPUT", "POLICY_BLOCKED", "REJECTED"].includes(
      normalized,
    )
  )
    return { label, tone: "danger" };
  if (["CANCELLED", "CANCELED", "WITHDRAWN"].includes(normalized))
    return { label, tone: "cancelled" };
  if (normalized === "SUPERSEDED") return { label, tone: "superseded" };
  if (
    ["DISABLED", "UNAVAILABLE", "NOT_ELIGIBLE", "INACTIVE"].includes(normalized)
  )
    return { label, tone: "disabled" };
  if (
    [
      "PENDING",
      "QUEUED",
      "SUBMITTED",
      "RUNNING",
      "PREPARING_INPUT",
      "READY_FOR_INFERENCE",
      "VALIDATING_OUTPUT",
      "CANCEL_REQUESTED",
      "HIGH",
      "DECISION_PENDING",
    ].includes(normalized)
  )
    return { label, tone: "warning" };
  if (
    [
      "DRAFT",
      "OPEN",
      "IN_PROGRESS",
      "UNDER_REVIEW",
      "EVIDENCE_COLLECTION",
    ].includes(normalized)
  )
    return { label, tone: "info" };
  if (normalized === "URGENT") return { label, tone: "danger" };
  return { label, tone: "neutral" };
}

const statusIcons = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: Clock3,
  danger: XCircle,
  cancelled: MinusCircle,
  superseded: AlertTriangle,
  disabled: MinusCircle,
};

export function StatusBadge({
  value,
  label,
  tone,
}: {
  value?: string;
  label?: string;
  tone?: StatusTone;
}) {
  const presentation = value
    ? statusPresentation(value)
    : { label: label ?? "Unknown", tone: tone ?? ("neutral" as const) };
  const resolvedTone = tone ?? presentation.tone;
  const Icon = statusIcons[resolvedTone];
  return (
    <span className={`status status-${resolvedTone}`}>
      <Icon size={13} aria-hidden="true" />
      {label ?? presentation.label}
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="section-header-actions">{actions}</div>}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  children,
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange(event: React.ChangeEvent<HTMLSelectElement>): void;
  children: React.ReactNode;
  hideLabel?: boolean;
}) {
  return (
    <label className="select-field">
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
      <span className="select-control">
        <select value={value} onChange={onChange}>
          {children}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </span>
    </label>
  );
}

export function CopyIdentifier({
  value,
  prefix,
}: {
  value: string;
  prefix?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <span className="identifier-with-copy">
      <span className="identifier-value">
        {prefix ? `${prefix} ${value}` : value}
      </span>
      <button
        type="button"
        className="identifier-copy"
        onClick={() => void copy()}
        aria-label={`Copy full identifier ${value}`}
      >
        <Copy size={14} aria-hidden="true" />
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Identifier copied" : ""}
      </span>
    </span>
  );
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || !dialog.current) return;
    previous.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const root = dialog.current;
    root.querySelector<HTMLButtonElement>("button")?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        root.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
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
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="modal-layer">
      <button
        type="button"
        className="modal-backdrop"
        onClick={onCancel}
        aria-label="Cancel emergency pause"
      />
      <section
        ref={dialog}
        className="modal-card confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-description"
      >
        <header className="modal-header">
          <div>
            <p className="eyebrow">Confirmation required</p>
            <h2 id="confirmation-dialog-title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="Cancel emergency pause"
          >
            <X size={18} />
          </button>
        </header>
        <div className="confirmation-dialog-body">
          <p id="confirmation-dialog-description">{description}</p>
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
              className="danger-button"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "Applying pause…" : confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
