import {
  AlertTriangle,
  CheckCircle2,
  Download,
  File as FileIcon,
  FileCheck2,
  Link2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionGate, useAuth } from "./auth";
import type { CaseLedgerController } from "./CaseLedger";
import { AnchorProofButton, EvidenceProofStatus } from "./LedgerProofs";

export type EvidenceVersion = {
  id: string;
  evidenceAssetId: string;
  versionNumber: number;
  previousVersionId: string | null;
  previousSha256: string | null;
  processingStatus: string;
  displayFilename: string;
  detectedMediaType: string | null;
  sizeBytes: string | null;
  sha256: string | null;
  scanEngine: string | null;
  scanCompletedAt: string | null;
  createdReason: string;
  createdByType: string;
  createdById: string;
  createdAt: string;
  availableAt: string | null;
  failureCode: string | null;
  failureDetail: string | null;
};

export type EvidenceAsset = {
  id: string;
  evidenceNumber: string;
  primaryCaseId: string;
  classificationCode: string;
  title: string;
  description: string | null;
  sourceType: string;
  sourceSystemId: string | null;
  connectorId: string | null;
  sourceTriggerId: string | null;
  externalReference: string | null;
  status: string;
  currentVersionId: string | null;
  latestVersionNumber: number;
  versionCount: number;
  rowVersion: number;
  createdByType: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  currentVersion?: EvidenceVersion | null;
  activeLegalHold?: {
    id: string;
    reason: string;
    actedAt: string;
  } | null;
};

type EvidenceList = {
  items: EvidenceAsset[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: {
    byStatus: Record<string, number>;
    byClassification: Record<string, number>;
  };
};

type IntegrityCheck = {
  id: string;
  versionId: string;
  status: string;
  expectedSha256: string;
  calculatedSha256: string | null;
  requestedAt: string;
  completedAt: string | null;
};

async function problem(response: Response) {
  const body = await response.json().catch(() => ({}));
  return new Error(
    typeof body.detail === "string"
      ? body.detail
      : `Request failed (${response.status}).`,
  );
}

export function EvidenceStatusBadge({ status }: { status: string }) {
  const good = ["ACTIVE", "AVAILABLE"].includes(status);
  const pending = [
    "AWAITING_CONTENT",
    "PROCESSING",
    "UPLOAD_PENDING",
    "UPLOADED",
    "SCANNING",
    "PENDING",
  ].includes(status);
  return (
    <span
      className={`status ${good ? "status-green" : pending ? "status-amber" : "status-purple"}`}
    >
      {good ? (
        <CheckCircle2 size={12} />
      ) : pending ? (
        <RefreshCw size={12} />
      ) : (
        <AlertTriangle size={12} />
      )}
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function EvidenceClassificationBadge({
  classification,
}: {
  classification: string;
}) {
  return (
    <span className="status status-blue">
      <FileIcon size={12} />
      {classification.replaceAll("_", " ")}
    </span>
  );
}

export function EvidenceTable({
  items,
  onSelect,
  ledger,
}: {
  items: EvidenceAsset[];
  onSelect(asset: EvidenceAsset): void;
  ledger?: CaseLedgerController;
}) {
  const targets = new Map(
    ledger?.summary?.evidenceTargets.map((target) => [
      target.evidenceVersionId,
      target,
    ]) ?? [],
  );
  return (
    <div className="table-wrap">
      <table className="evidence-table">
        <thead>
          <tr>
            <th>Evidence</th>
            <th>Classification</th>
            <th>Status</th>
            <th>Version</th>
            {ledger && <th>Ledger proof</th>}
            <th>Source</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <button className="case-link" onClick={() => onSelect(item)}>
                  <strong>{item.title}</strong>
                  <span>{item.evidenceNumber}</span>
                </button>
              </td>
              <td>
                <EvidenceClassificationBadge
                  classification={item.classificationCode}
                />
              </td>
              <td>
                <EvidenceStatusBadge status={item.status} />
              </td>
              <td>
                {item.latestVersionNumber
                  ? `v${item.latestVersionNumber} · ${item.versionCount} total`
                  : "Awaiting content"}
              </td>
              {ledger && (
                <td>
                  <EvidenceProofStatus
                    lifecycle={
                      item.currentVersionId
                        ? (targets.get(item.currentVersionId)?.lifecycle ??
                          null)
                        : null
                    }
                    eligibility={
                      item.currentVersionId
                        ? targets.get(item.currentVersionId)?.eligibility
                        : undefined
                    }
                  />
                </td>
              )}
              <td>{item.sourceType.replaceAll("_", " ")}</td>
              <td>{age(item.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EvidencePanel({
  caseId,
  ledger,
  onOpenLedger,
}: {
  caseId: string;
  ledger?: CaseLedgerController;
  onOpenLedger(): void;
}) {
  const auth = useAuth();
  const [search, setSearch] = useState("");
  const [classification, setClassification] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [upload, setUpload] = useState<EvidenceAsset | true | null>(null);
  const [selected, setSelected] = useState<EvidenceAsset | null>(null);
  const evidence = useQuery({
    queryKey: [
      "case-evidence",
      caseId,
      search,
      classification,
      status,
      source,
      page,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "10",
      });
      if (search) params.set("search", search);
      if (classification) params.set("classification", classification);
      if (status) params.set("status", status);
      if (source) params.set("source", source);
      const response = await auth.request(
        `/api/v1/cases/${caseId}/evidence?${params}`,
      );
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<EvidenceList>;
    },
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === "PROCESSING")
        ? 2500
        : false,
  });
  return (
    <div className="detail-section evidence-case-tab">
      <div className="evidence-section-heading">
        <div>
          <h3>Evidence</h3>
          <p className="muted-cell">
            Quarantined, scanned, immutable case evidence.
          </p>
        </div>
        <PermissionGate permission="evidence:upload">
          <button className="primary-button" onClick={() => setUpload(true)}>
            <Plus size={16} />
            Upload evidence
          </button>
        </PermissionGate>
      </div>
      <div className="evidence-summary-grid" aria-label="Evidence summary">
        <span>
          <strong>{evidence.data?.total ?? 0}</strong>Total
        </span>
        <span>
          <strong>{evidence.data?.summary.byStatus.ACTIVE ?? 0}</strong>Active
        </span>
        <span>
          <strong>
            {evidence.data?.summary.byStatus.AWAITING_CONTENT ?? 0}
          </strong>
          Awaiting content
        </span>
        <span>
          <strong>
            {(evidence.data?.summary.byStatus.PROCESSING ?? 0) +
              (evidence.data?.summary.byStatus.REJECTED ?? 0)}
          </strong>
          Attention
        </span>
      </div>
      <div className="evidence-filters">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search evidence"
          aria-label="Search evidence"
        />
        <select
          value={classification}
          onChange={(event) => {
            setClassification(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by classification"
        >
          <option value="">All classifications</option>
          {[
            "IDENTITY",
            "INCOME",
            "BANK_STATEMENT",
            "CREDIT_REPORT",
            "APPLICATION_FORM",
            "COLLATERAL",
            "CORRESPONDENCE",
            "DECISION_RECORD",
            "OTHER",
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by evidence status"
        >
          <option value="">All statuses</option>
          {[
            "AWAITING_CONTENT",
            "PROCESSING",
            "ACTIVE",
            "ON_HOLD",
            "ARCHIVED",
            "REJECTED",
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by evidence source"
        >
          <option value="">All sources</option>
          <option>USER_UPLOAD</option>
          <option>SOURCE_TRIGGER_REFERENCE</option>
          <option>INTERNAL</option>
        </select>
      </div>
      {evidence.isLoading ? (
        <div className="empty-state">Loading evidence…</div>
      ) : evidence.isError ? (
        <div className="api-problem">{evidence.error.message}</div>
      ) : evidence.data?.items.length ? (
        <>
          <EvidenceTable
            items={evidence.data.items}
            onSelect={setSelected}
            ledger={ledger}
          />
          <div className="card-footer">
            <button
              className="text-button"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {evidence.data.totalPages || 1}
            </span>
            <button
              className="text-button"
              disabled={page >= evidence.data.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          No evidence matches the current filters.
        </div>
      )}
      {upload && (
        <EvidenceUploadDialog
          caseId={caseId}
          awaiting={upload === true ? undefined : upload}
          onClose={() => setUpload(null)}
          onAccepted={() => setUpload(null)}
        />
      )}
      {selected && (
        <EvidenceDetail
          assetId={selected.id}
          ledger={ledger}
          onOpenLedger={onOpenLedger}
          onClose={() => setSelected(null)}
          onUpload={() => {
            setUpload(selected);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

export function FileDropZone({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile(file: File): void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`file-drop-zone ${dragging ? "file-drop-zone-active" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const next = event.dataTransfer.files[0];
        if (next) onFile(next);
      }}
    >
      <UploadCloud size={28} />
      <strong>{file ? file.name : "Drop a file here"}</strong>
      <span>
        PDF, PNG, JPEG, or plain text · maximum 10 MiB · scanned before use
      </span>
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Choose file
      </button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) onFile(next);
        }}
        aria-label="Choose evidence file"
      />
    </div>
  );
}

export function UploadProgress({
  progress,
  state,
}: {
  progress: number;
  state: string;
}) {
  return (
    <div className="upload-progress" aria-live="polite">
      <div>
        <span>{state}</span>
        <strong>{progress}%</strong>
      </div>
      <progress max={100} value={progress} />
    </div>
  );
}

export function EvidenceUploadDialog({
  caseId,
  awaiting,
  onClose,
  onAccepted,
}: {
  caseId: string;
  awaiting?: EvidenceAsset;
  onClose(): void;
  onAccepted(): void;
}) {
  const auth = useAuth();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(awaiting?.title ?? "");
  const [classification, setClassification] = useState(
    awaiting?.classificationCode ?? "OTHER",
  );
  const [description, setDescription] = useState(awaiting?.description ?? "");
  const [reason, setReason] = useState(
    awaiting?.latestVersionNumber ? "REPLACEMENT" : "INITIAL",
  );
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState("Ready");
  const [error, setError] = useState("");
  const xhr = useRef<XMLHttpRequest | null>(null);
  const uploading = state === "Uploading";

  function submit() {
    if (!file || !title.trim()) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("The selected file exceeds the 10 MiB limit.");
      return;
    }
    if (
      !["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(
        file.type,
      )
    ) {
      setError("The selected file type is not supported.");
      return;
    }
    setError("");
    setState("Uploading");
    const form = new FormData();
    form.append("classificationCode", classification);
    form.append("title", title.trim());
    form.append("description", description.trim());
    form.append("declaredSizeBytes", String(file.size));
    form.append("reason", reason);
    form.append("file", file, file.name);
    const request = new XMLHttpRequest();
    xhr.current = request;
    const path = awaiting
      ? `/api/v1/evidence/${awaiting.id}/versions`
      : `/api/v1/cases/${caseId}/evidence`;
    request.open("POST", path);
    if (auth.token)
      request.setRequestHeader("authorization", `Bearer ${auth.token}`);
    request.setRequestHeader("idempotency-key", crypto.randomUUID());
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => {
      setState("Failed");
      setError("The upload connection failed.");
    };
    request.onabort = () => {
      setState("Cancelled");
      setError("Upload cancelled.");
    };
    request.onload = () => {
      if (request.status === 202) {
        setProgress(100);
        setState("Queued for security scan");
        void client.invalidateQueries({ queryKey: ["case-evidence", caseId] });
        window.setTimeout(onAccepted, 700);
        return;
      }
      setState("Failed");
      try {
        const body = JSON.parse(request.responseText);
        setError(body.detail ?? `Upload failed (${request.status}).`);
      } catch {
        setError(`Upload failed (${request.status}).`);
      }
    };
    request.send(form);
  }

  return (
    <div className="modal-layer">
      <button
        className="modal-backdrop"
        onClick={uploading ? undefined : onClose}
        aria-label="Close upload"
      />
      <section
        className="modal-card evidence-upload-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-upload-title"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Secure intake</p>
            <h2 id="evidence-upload-title">
              {awaiting ? "Provide evidence content" : "Upload case evidence"}
            </h2>
          </div>
          <button
            className="icon-button"
            disabled={uploading}
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </button>
        </div>
        <div className="evidence-upload-body">
          <FileDropZone file={file} onFile={setFile} disabled={uploading} />
          <div className="form-grid">
            <label>
              Classification
              <select
                value={classification}
                disabled={Boolean(awaiting) || uploading}
                onChange={(event) => setClassification(event.target.value)}
              >
                {[
                  "IDENTITY",
                  "INCOME",
                  "BANK_STATEMENT",
                  "CREDIT_REPORT",
                  "APPLICATION_FORM",
                  "COLLATERAL",
                  "CORRESPONDENCE",
                  "DECISION_RECORD",
                  "OTHER",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                value={title}
                disabled={Boolean(awaiting) || uploading}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={240}
              />
            </label>
            {awaiting?.latestVersionNumber ? (
              <label>
                Version reason
                <select
                  value={reason}
                  disabled={uploading}
                  onChange={(event) => setReason(event.target.value)}
                >
                  <option>CORRECTION</option>
                  <option>REPLACEMENT</option>
                  <option>DERIVED</option>
                </select>
              </label>
            ) : null}
            <label className="wide-field">
              Description
              <textarea
                value={description}
                disabled={Boolean(awaiting) || uploading}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
              />
            </label>
          </div>
          {state !== "Ready" && (
            <UploadProgress progress={progress} state={state} />
          )}
          {error && <div className="api-problem">{error}</div>}
        </div>
        <div className="modal-actions">
          {uploading ? (
            <button
              className="secondary-button"
              onClick={() => xhr.current?.abort()}
            >
              Cancel upload
            </button>
          ) : (
            <button className="secondary-button" onClick={onClose}>
              Close
            </button>
          )}
          <button
            className="primary-button"
            disabled={!file || !title.trim() || uploading}
            onClick={submit}
          >
            <ShieldCheck size={16} />
            Upload to quarantine
          </button>
        </div>
      </section>
    </div>
  );
}

export function VersionHistory({
  versions,
  onDownload,
}: {
  versions: EvidenceVersion[];
  onDownload(version: EvidenceVersion): void;
}) {
  return (
    <div className="version-history">
      {versions.map((version) => (
        <div className="version-row" key={version.id}>
          <span className="version-number">v{version.versionNumber}</span>
          <div>
            <strong>{version.displayFilename}</strong>
            <small>
              {version.createdReason} ·{" "}
              {new Date(version.createdAt).toLocaleString()}
            </small>
            {version.failureDetail && <small>{version.failureDetail}</small>}
          </div>
          <EvidenceStatusBadge status={version.processingStatus} />
          <PermissionGate permission="evidence:download">
            <button
              className="icon-button"
              disabled={version.processingStatus !== "AVAILABLE"}
              onClick={() => onDownload(version)}
              aria-label={`Download version ${version.versionNumber}`}
            >
              <Download size={16} />
            </button>
          </PermissionGate>
        </div>
      ))}
    </div>
  );
}

export function SecureDownloadButton({
  assetId,
  version,
}: {
  assetId: string;
  version: EvidenceVersion;
}) {
  const auth = useAuth();
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="primary-button"
        disabled={version.processingStatus !== "AVAILABLE"}
        onClick={async () => {
          setError("");
          const response = await auth.request(
            `/api/v1/evidence/${assetId}/versions/${version.id}/download-grant`,
            { method: "POST" },
          );
          if (!response.ok) return setError((await problem(response)).message);
          const grant = (await response.json()) as { url: string };
          await downloadProtected(
            auth.request,
            grant.url,
            version.displayFilename,
          );
        }}
      >
        <Download size={16} />
        Controlled download
      </button>
      {error && <div className="api-problem">{error}</div>}
    </>
  );
}

export function IntegrityCheckPanel({
  asset,
  versions,
}: {
  asset: EvidenceAsset;
  versions: EvidenceVersion[];
}) {
  const auth = useAuth();
  const client = useQueryClient();
  const checks = useQuery({
    queryKey: ["evidence-integrity", asset.id],
    queryFn: async () => {
      const response = await auth.request(
        `/api/v1/evidence/${asset.id}/integrity-checks`,
      );
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<IntegrityCheck[]>;
    },
    refetchInterval: (query) =>
      query.state.data?.some((check) => check.status === "PENDING")
        ? 2500
        : false,
  });
  const current = versions.find(
    (version) => version.id === asset.currentVersionId,
  );
  return (
    <section className="evidence-detail-panel">
      <div className="evidence-section-heading">
        <div>
          <h3>Integrity verification</h3>
          <p>
            Re-hash canonical bytes without changing the authoritative hash.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={!current}
          onClick={async () => {
            if (!current) return;
            const response = await auth.request(
              `/api/v1/evidence/${asset.id}/versions/${current.id}/integrity-checks`,
              { method: "POST" },
            );
            if (response.ok)
              void client.invalidateQueries({
                queryKey: ["evidence-integrity", asset.id],
              });
          }}
        >
          <FileCheck2 size={16} />
          Verify current version
        </button>
      </div>
      {checks.data?.map((check) => (
        <div className="control-row" key={check.id}>
          <span>{new Date(check.requestedAt).toLocaleString()}</span>
          <EvidenceStatusBadge status={check.status} />
          <small>Version {versionNumber(versions, check.versionId)}</small>
        </div>
      ))}
      {!checks.data?.length && (
        <p className="muted-cell">No integrity checks requested.</p>
      )}
    </section>
  );
}

export function EvidenceLineagePanel({ asset }: { asset: EvidenceAsset }) {
  const auth = useAuth();
  const [relatedId, setRelatedId] = useState("");
  const [relationshipType, setRelationshipType] = useState("RELATED_TO");
  const client = useQueryClient();
  const lineage = useQuery({
    queryKey: ["evidence-lineage", asset.id],
    queryFn: async () => {
      const response = await auth.request(
        `/api/v1/evidence/${asset.id}/lineage`,
      );
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<{
        versions: EvidenceVersion[];
        relationships: Array<{
          id: string;
          direction: string;
          type: string;
          relatedEvidenceId: string;
          createdAt: string;
        }>;
      }>;
    },
  });
  return (
    <section className="evidence-detail-panel">
      <h3>Lineage and relationships</h3>
      {lineage.data?.relationships.map((relationship) => (
        <div className="control-row" key={relationship.id}>
          <Link2 size={15} />
          <strong>{relationship.type}</strong>
          <span>{relationship.relatedEvidenceId}</span>
          <small>{relationship.direction}</small>
        </div>
      ))}
      {!lineage.data?.relationships.length && (
        <p className="muted-cell">No explicit asset relationships.</p>
      )}
      <PermissionGate permission="evidence:metadata:update">
        <div className="evidence-relationship-form">
          <input
            value={relatedId}
            onChange={(event) => setRelatedId(event.target.value)}
            placeholder="Related evidence UUID"
            aria-label="Related evidence UUID"
          />
          <select
            value={relationshipType}
            onChange={(event) => setRelationshipType(event.target.value)}
            aria-label="Relationship type"
          >
            <option>CORRECTS</option>
            <option>REPLACES</option>
            <option>DERIVED_FROM</option>
            <option>SUPPORTS</option>
            <option>RELATED_TO</option>
          </select>
          <button
            className="secondary-button"
            disabled={!relatedId}
            onClick={async () => {
              const response = await auth.request(
                `/api/v1/evidence/${asset.id}/relationships`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    relatedEvidenceId: relatedId,
                    relationshipType,
                  }),
                },
              );
              if (response.ok) {
                setRelatedId("");
                void client.invalidateQueries({
                  queryKey: ["evidence-lineage", asset.id],
                });
              }
            }}
          >
            Add relationship
          </button>
        </div>
      </PermissionGate>
    </section>
  );
}

export function LegalHoldIndicator({
  asset,
  onChanged,
}: {
  asset: EvidenceAsset;
  onChanged(): void;
}) {
  const auth = useAuth();
  return (
    <div className="legal-hold">
      <LockKeyhole size={18} />
      <div>
        <strong>
          {asset.activeLegalHold ? "Legal hold active" : "No legal hold"}
        </strong>
        <span>
          {asset.activeLegalHold?.reason ??
            "Canonical evidence remains immutable in Phase 3."}
        </span>
      </div>
      <PermissionGate permission="evidence:hold">
        <button
          className="secondary-button"
          onClick={async () => {
            const promptText = asset.activeLegalHold
              ? "Reason for releasing this legal hold:"
              : "Reason for placing this legal hold:";
            const reason = window.prompt(promptText);
            if (!reason) return;
            if (
              !window.confirm(
                asset.activeLegalHold
                  ? "Release this legal hold?"
                  : "Place this evidence on legal hold?",
              )
            )
              return;
            const path = asset.activeLegalHold
              ? `/api/v1/evidence/${asset.id}/legal-holds/${asset.activeLegalHold.id}/release`
              : `/api/v1/evidence/${asset.id}/legal-holds`;
            const response = await auth.request(path, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reason }),
            });
            if (response.ok) onChanged();
          }}
        >
          {asset.activeLegalHold ? "Release hold" : "Place hold"}
        </button>
      </PermissionGate>
    </div>
  );
}

export function ProcessingStatusPanel({
  asset,
  versions,
}: {
  asset: EvidenceAsset;
  versions: EvidenceVersion[];
}) {
  const latest = versions[0];
  if (!latest || latest.processingStatus === "AVAILABLE") return null;
  return (
    <div className="processing-panel">
      <EvidenceStatusBadge status={latest.processingStatus} />
      <div>
        <strong>
          {latest.processingStatus === "REJECTED"
            ? "Security scan rejected this version"
            : latest.processingStatus === "FAILED"
              ? "Processing could not complete"
              : "Evidence is being quarantined and scanned"}
        </strong>
        <span>
          {latest.failureDetail ??
            "Downloads remain disabled until a clean scan and immutable promotion complete."}
        </span>
      </div>
    </div>
  );
}

export function EvidenceDetail({
  assetId,
  ledger,
  onOpenLedger,
  onClose,
  onUpload,
}: {
  assetId: string;
  ledger?: CaseLedgerController;
  onOpenLedger(): void;
  onClose(): void;
  onUpload(): void;
}) {
  const auth = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const asset = useQuery({
    queryKey: ["evidence", assetId],
    queryFn: async () => {
      const response = await auth.request(`/api/v1/evidence/${assetId}`);
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<EvidenceAsset>;
    },
    refetchInterval: (query) =>
      query.state.data?.status === "PROCESSING" ? 2500 : false,
  });
  const versions = useQuery({
    queryKey: ["evidence-versions", assetId],
    queryFn: async () => {
      const response = await auth.request(
        `/api/v1/evidence/${assetId}/versions`,
      );
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<EvidenceVersion[]>;
    },
    refetchInterval: (query) =>
      query.state.data?.some((version) =>
        ["UPLOAD_PENDING", "UPLOADED", "SCANNING"].includes(
          version.processingStatus,
        ),
      )
        ? 2500
        : false,
  });
  useEffect(() => {
    if (asset.data && !editing) {
      setTitle(asset.data.title);
      setDescription(asset.data.description ?? "");
    }
  }, [asset.data, editing]);
  const item = asset.data;
  return (
    <div className="modal-layer evidence-detail-layer">
      <button className="modal-backdrop" onClick={onClose} />
      <section className="modal-card evidence-detail-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{item?.evidenceNumber ?? "Evidence"}</p>
            <h2>{item?.title ?? "Loading evidence…"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {!item ? (
          <div className="empty-state">Loading evidence detail…</div>
        ) : (
          <>
            <div className="evidence-detail-summary">
              <EvidenceStatusBadge status={item.status} />
              <EvidenceClassificationBadge
                classification={item.classificationCode}
              />
              <span>{item.sourceType.replaceAll("_", " ")}</span>
              <span>Case {item.primaryCaseId}</span>
            </div>
            <ProcessingStatusPanel
              asset={item}
              versions={versions.data ?? []}
            />
            <LegalHoldIndicator
              asset={item}
              onChanged={() =>
                void client.invalidateQueries({
                  queryKey: ["evidence", assetId],
                })
              }
            />
            <section className="evidence-detail-panel">
              <div className="evidence-section-heading">
                <div>
                  <h3>Asset metadata</h3>
                  <p>Stable identity and safe source provenance.</p>
                </div>
                <PermissionGate permission="evidence:metadata:update">
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      if (!editing) {
                        setEditing(true);
                        return;
                      }
                      const response = await auth.request(
                        `/api/v1/evidence/${item.id}`,
                        {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            rowVersion: item.rowVersion,
                            title,
                            description,
                          }),
                        },
                      );
                      if (!response.ok) {
                        const issue = await problem(response);
                        setError(
                          response.status === 409
                            ? "This evidence changed elsewhere. Reload before saving."
                            : issue.message,
                        );
                        return;
                      }
                      setEditing(false);
                      void client.invalidateQueries({
                        queryKey: ["evidence", assetId],
                      });
                    }}
                  >
                    {editing ? "Save metadata" : "Edit metadata"}
                  </button>
                </PermissionGate>
              </div>
              <div className="form-grid">
                <label>
                  Title
                  <input
                    value={title}
                    disabled={!editing}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  External reference
                  <strong>{item.externalReference ?? "—"}</strong>
                </label>
                <label className="wide-field">
                  Description
                  <textarea
                    value={description}
                    disabled={!editing}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
              </div>
              {error && <div className="api-problem">{error}</div>}
            </section>
            <section className="evidence-detail-panel">
              <div className="evidence-section-heading">
                <div>
                  <h3>Immutable versions</h3>
                  <p>Every correction and replacement remains accessible.</p>
                </div>
                <PermissionGate permission="evidence:version:create">
                  <button className="secondary-button" onClick={onUpload}>
                    <UploadCloud size={16} />
                    {item.latestVersionNumber ? "New version" : "Add content"}
                  </button>
                </PermissionGate>
              </div>
              <VersionHistory
                versions={versions.data ?? []}
                onDownload={async (version) => {
                  const response = await auth.request(
                    `/api/v1/evidence/${item.id}/versions/${version.id}/download-grant`,
                    { method: "POST" },
                  );
                  if (!response.ok)
                    return setError((await problem(response)).message);
                  const grant = (await response.json()) as { url: string };
                  await downloadProtected(
                    auth.request,
                    grant.url,
                    version.displayFilename,
                  );
                }}
              />
              {item.currentVersion && (
                <PermissionGate permission="evidence:download">
                  <SecureDownloadButton
                    assetId={item.id}
                    version={item.currentVersion}
                  />
                </PermissionGate>
              )}
            </section>
            <PermissionGate permission="evidence:verify">
              <IntegrityCheckPanel
                asset={item}
                versions={versions.data ?? []}
              />
            </PermissionGate>
            {item.currentVersion && ledger && (
              <section className="evidence-detail-panel ledger-proof-panel">
                <div className="evidence-section-heading">
                  <div>
                    <h3>Ledger proof</h3>
                    <p>Shared case-level proof state for this exact version.</p>
                  </div>
                  {(() => {
                    const target = ledger.summary?.evidenceTargets.find(
                      (candidate) =>
                        candidate.evidenceVersionId === item.currentVersion?.id,
                    );
                    return (
                      <EvidenceProofStatus
                        lifecycle={target?.lifecycle ?? null}
                        eligibility={target?.eligibility}
                      />
                    );
                  })()}
                </div>
                <div className="case-panel-actions">
                  {!ledger.proofs.some(
                    (proof) =>
                      proof.evidenceVersionId === item.currentVersion?.id,
                  ) &&
                    ledger.canCreate &&
                    item.currentVersion.processingStatus === "AVAILABLE" && (
                      <AnchorProofButton
                        busy={ledger.busy}
                        disabled={!ledger.summary?.ledgerAvailability.available}
                        disabledReason={
                          !ledger.summary?.ledgerAvailability.available
                            ? "The configured ledger provider is unavailable."
                            : undefined
                        }
                        label="Anchor proof"
                        onClick={() =>
                          void ledger.anchorEvidence(
                            item.id,
                            item.currentVersion!.id,
                          )
                        }
                      />
                    )}
                  <button
                    className="secondary-button"
                    onClick={() => {
                      onClose();
                      onOpenLedger();
                    }}
                  >
                    Open ledger history
                  </button>
                </div>
              </section>
            )}
            <EvidenceLineagePanel asset={item} />
          </>
        )}
      </section>
    </div>
  );
}

function age(value: string) {
  const days = Math.floor(
    (Date.now() - new Date(value).valueOf()) / (24 * 60 * 60 * 1000),
  );
  return days <= 0 ? "Today" : `${days}d`;
}

function versionNumber(versions: EvidenceVersion[], id: string) {
  return versions.find((version) => version.id === id)?.versionNumber ?? "—";
}

async function downloadProtected(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  path: string,
  filename: string,
) {
  const response = await request(path);
  if (!response.ok) throw await problem(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
