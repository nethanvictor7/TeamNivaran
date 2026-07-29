import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  ArrowUpDown,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  FileChartColumn,
  FileSearch,
  Fingerprint,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PermissionGate, useAuth } from "./auth";
import {
  ConfirmationDialog,
  CopyIdentifier,
  SelectField,
  StatusBadge,
} from "./ui";

type AuditRecord = {
  id: string;
  eventId: string;
  occurredAt: string;
  sourceService: string;
  eventType: string;
  actorType: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  outcome: string;
  classification: string;
  recordHash: string;
  previousRecordHash: string | null;
  sourceTopic: string;
  sourcePartition: number;
  sourceOffset: string;
  lateArrival: boolean;
  metadata: Record<string, unknown>;
};

type AuditPage = {
  items: AuditRecord[];
  nextCursor: string | null;
  snapshotBoundary: string;
  freshness: {
    status: string;
    projectionVersion: number;
    lastIngestedAt: string | null;
  };
};

type Run = {
  id: string;
  state: string;
  createdAt: string;
  completedAt: string | null;
  rowCount: number;
  checksumSha256: string | null;
  artifactFilename: string | null;
  failureCode: string | null;
  expiresAt: string;
};

type ReportRun = Run & { reportKey: string; reportVersion: string };
type ExportRun = Run & { format: string };
type Tab = "explorer" | "journeys" | "reports" | "exports" | "operations";

async function responseProblem(response: Response) {
  const data = (await response.json().catch(() => null)) as {
    detail?: string;
    message?: string;
  } | null;
  return new Error(
    data?.detail ?? data?.message ?? `Request failed (${response.status}).`,
  );
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function AuditTabs({
  active,
  onChange,
}: {
  active: Tab;
  onChange(value: Tab): void;
}) {
  const auth = useAuth();
  const tabs: [Tab, string, typeof Search][] = [
    ["explorer", "Audit explorer", Search],
    ["journeys", "Case journeys", Activity],
    ["reports", "Reports", FileChartColumn],
    ["exports", "Exports", Archive],
    ["operations", "Operations", Wrench],
  ];
  return (
    <nav className="audit-tabs" aria-label="Audit and reporting">
      {tabs
        .filter(
          ([value]) =>
            value !== "operations" ||
            auth.identity?.permissions.includes("audit:operations"),
        )
        .map(([value, label, Icon]) => (
          <button
            type="button"
            key={value}
            className={active === value ? "audit-tab-active" : ""}
            aria-current={active === value ? "page" : undefined}
            onClick={() => onChange(value)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
    </nav>
  );
}

export function AuditWorkspace() {
  const [tab, setTab] = useState<Tab>("explorer");
  return (
    <div className="audit-workspace">
      <section className="page-heading audit-page-heading">
        <div>
          <p className="eyebrow">Compliance records</p>
          <h1>Audit, reporting & exports</h1>
          <p className="page-subtitle">
            Search activity, follow a case from start to finish and create
            reports or exports.
          </p>
        </div>
        <span className="audit-control-state">
          <ShieldCheck size={16} aria-hidden="true" />
          Recording active
        </span>
      </section>
      <section className="card audit-surface">
        <AuditTabs active={tab} onChange={setTab} />
        {tab === "explorer" && <AuditExplorer />}
        {tab === "journeys" && <CaseJourney />}
        {tab === "reports" && <ReportCenter />}
        {tab === "exports" && <ExportCenter />}
        {tab === "operations" && <AuditOperations />}
      </section>
    </div>
  );
}

function AuditExplorer() {
  const auth = useAuth();
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [search, setSearch] = useState(() => initial.get("search") ?? "");
  const [eventType, setEventType] = useState(
    () => initial.get("eventType") ?? "",
  );
  const [outcome, setOutcome] = useState(() => initial.get("outcome") ?? "");
  const [sourceService, setSourceService] = useState(
    () => initial.get("sourceService") ?? "",
  );
  const [classification, setClassification] = useState(
    () => initial.get("classification") ?? "",
  );
  const [resourceId, setResourceId] = useState(
    () => initial.get("resourceId") ?? "",
  );
  const [correlationId, setCorrelationId] = useState(
    () => initial.get("correlationId") ?? "",
  );
  const [from, setFrom] = useState(() => initial.get("from") ?? "");
  const [to, setTo] = useState(() => initial.get("to") ?? "");
  const [sort, setSort] = useState(
    () => initial.get("sort") ?? "OCCURRED_DESC",
  );
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const queryString = useMemo(() => {
    const query = new URLSearchParams({ pageSize: "50" });
    if (search.trim()) query.set("search", search.trim());
    if (eventType.trim()) query.set("eventType", eventType.trim());
    if (outcome) query.set("outcome", outcome);
    if (sourceService.trim()) query.set("sourceService", sourceService.trim());
    if (classification) query.set("classification", classification);
    if (resourceId.trim()) query.set("resourceId", resourceId.trim());
    if (correlationId.trim()) query.set("correlationId", correlationId.trim());
    if (from) query.set("from", new Date(from).toISOString());
    if (to) query.set("to", new Date(to).toISOString());
    query.set("sort", sort);
    return query.toString();
  }, [
    classification,
    correlationId,
    eventType,
    from,
    outcome,
    resourceId,
    search,
    sourceService,
    sort,
    to,
  ]);
  const requestQuery = useMemo(() => {
    const query = new URLSearchParams(queryString);
    if (cursor) query.set("cursor", cursor);
    return query.toString();
  }, [cursor, queryString]);
  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
  }, [queryString]);
  useEffect(() => {
    const visible = new URLSearchParams(queryString);
    visible.delete("pageSize");
    if (from) visible.set("from", from);
    if (to) visible.set("to", to);
    const next = `/audit${visible.size ? `?${visible}` : ""}`;
    if (`${location.pathname}${location.search}` !== next)
      history.replaceState(null, "", next);
  }, [from, queryString, to]);
  const activeFilters = [
    ["Search", search, setSearch],
    ["Event", eventType, setEventType],
    ["Outcome", outcome, setOutcome],
    ["Source", sourceService, setSourceService],
    ["Classification", classification, setClassification],
    ["Resource", resourceId, setResourceId],
    ["Correlation", correlationId, setCorrelationId],
    ["From", from, setFrom],
    ["To", to, setTo],
    [
      "Sort",
      sort === "OCCURRED_ASC" ? "Oldest first" : "",
      () => setSort("OCCURRED_DESC"),
    ],
  ].filter(([, value]) => value) as [
    string,
    string,
    React.Dispatch<React.SetStateAction<string>>,
  ][];
  const query = useQuery({
    queryKey: ["audit-records", requestQuery],
    queryFn: async ({ signal }) => {
      const response = await auth.request(
        `/api/v1/audit/records?${requestQuery}`,
        {
          signal,
        },
      );
      if (!response.ok) throw await responseProblem(response);
      return response.json() as Promise<AuditPage>;
    },
  });

  return (
    <div className="audit-pane">
      <div className="audit-toolbar">
        <label className="audit-search">
          <span className="sr-only">Search audit records</span>
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search event, service, actor or resource"
          />
        </label>
        <label className="audit-event-filter">
          <span className="sr-only">Exact event type</span>
          <input
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
            placeholder="Exact event type"
          />
        </label>
        <SelectField
          label="Outcome"
          hideLabel
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        >
          <option value="">All outcomes</option>
          <option>SUCCESS</option>
          <option>FAILURE</option>
          <option>DENIED</option>
          <option>PENDING</option>
          <option>INFORMATIONAL</option>
        </SelectField>
        <button
          type="button"
          className="secondary-button audit-refresh"
          onClick={() => void query.refetch()}
          aria-label="Refresh audit records"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <details className="audit-advanced-filters">
        <summary>Advanced filters</summary>
        <div>
          <label>
            <span>Source service</span>
            <input
              value={sourceService}
              onChange={(event) => setSourceService(event.target.value)}
              placeholder="evidence-service"
            />
          </label>
          <label>
            <span>Classification</span>
            <select
              value={classification}
              onChange={(event) => setClassification(event.target.value)}
            >
              <option value="">All classifications</option>
              <option>INTERNAL</option>
              <option>CONFIDENTIAL</option>
            </select>
          </label>
          <label>
            <span>Resource ID</span>
            <input
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              placeholder="Resource ID"
            />
          </label>
          <label>
            <span>Correlation ID</span>
            <input
              value={correlationId}
              onChange={(event) => setCorrelationId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label>
            <span>Occurred from</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            <span>Occurred to</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
      </details>
      {activeFilters.length > 0 && (
        <div className="audit-filter-chips" aria-label="Active audit filters">
          {activeFilters.map(([label, value, clear]) => (
            <button type="button" key={label} onClick={() => clear("")}>
              <span>
                {label}: {value}
              </span>
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            className="audit-clear-filters"
            onClick={() => {
              activeFilters.forEach(([, , clear]) => clear(""));
            }}
          >
            Clear all
          </button>
        </div>
      )}
      <div className="audit-freshness" role="status">
        <span>
          <CheckCircle2 size={14} aria-hidden="true" />
          Audit data {query.data?.freshness.status ?? "loading"}
        </span>
        <span>
          Index version {query.data?.freshness.projectionVersion ?? "—"}
        </span>
        <span>
          Fresh as of {formatDate(query.data?.freshness.lastIngestedAt ?? null)}
        </span>
      </div>
      {query.isError ? (
        <div className="api-problem">{query.error.message}</div>
      ) : query.isLoading ? (
        <div className="empty-state">Loading audit records…</div>
      ) : query.data?.items.length === 0 ? (
        <div className="empty-state">
          No audit records match the current filters.
        </div>
      ) : (
        <div className="audit-register">
          <div className="table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="audit-sort-button"
                      onClick={() =>
                        setSort((value) =>
                          value === "OCCURRED_DESC"
                            ? "OCCURRED_ASC"
                            : "OCCURRED_DESC",
                        )
                      }
                    >
                      Occurred
                      <ArrowUpDown size={12} aria-hidden="true" />
                      <span className="sr-only">
                        {sort === "OCCURRED_DESC"
                          ? "Newest first; activate for oldest first"
                          : "Oldest first; activate for newest first"}
                      </span>
                    </button>
                  </th>
                  <th>Event</th>
                  <th>Service</th>
                  <th>Actor</th>
                  <th>Resource</th>
                  <th>Outcome</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td className="audit-date-cell">
                      {formatDate(item.occurredAt)}
                    </td>
                    <td>
                      <strong
                        className="audit-event-name"
                        title={item.eventType}
                      >
                        {item.eventType}
                      </strong>
                      <small>{item.classification}</small>
                    </td>
                    <td>{item.sourceService}</td>
                    <td>
                      <span className="audit-cell-stack">
                        <strong>{item.actorType}</strong>
                        <small title={item.actorId}>{item.actorId}</small>
                      </span>
                    </td>
                    <td>
                      <span className="audit-cell-stack">
                        <strong>{item.resourceType}</strong>
                        <small title={item.resourceId}>{item.resourceId}</small>
                      </span>
                    </td>
                    <td>
                      <StatusBadge value={item.outcome} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setSelected(item)}
                        aria-label={`View ${item.eventType} details`}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="audit-pagination">
            <span>Showing {query.data?.items.length ?? 0} records</span>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={!cursorStack.length}
                onClick={() => {
                  const previous = cursorStack.at(-1) ?? null;
                  setCursor(previous);
                  setCursorStack((items) => items.slice(0, -1));
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!query.data?.nextCursor}
                onClick={() => {
                  setCursorStack((items) => [...items, cursor]);
                  setCursor(query.data?.nextCursor ?? null);
                }}
              >
                Next
              </button>
            </div>
          </footer>
          {selected && (
            <AuditDetail item={selected} onClose={() => setSelected(null)} />
          )}
        </div>
      )}
    </div>
  );
}

function AuditDetail({
  item,
  onClose,
}: {
  item: AuditRecord;
  onClose(): void;
}) {
  const fields = [
    ["Audit record", item.id],
    ["Event ID", item.eventId],
    ["Correlation ID", item.correlationId],
    ["Resource", `${item.resourceType} · ${item.resourceId}`],
    [
      "Kafka position",
      `${item.sourceTopic} · ${item.sourcePartition}:${item.sourceOffset}`,
    ],
    ["Record hash", item.recordHash],
    ["Previous hash", item.previousRecordHash ?? "Genesis record"],
  ] as const;
  return (
    <aside className="audit-detail" aria-label="Audit record detail">
      <header>
        <div>
          <p className="eyebrow">Audit record</p>
          <h2>{item.eventType}</h2>
          <p>{formatDate(item.occurredAt)}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close audit details"
        >
          <X size={17} />
        </button>
      </header>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <CopyIdentifier value={value} />
            </dd>
          </div>
        ))}
      </dl>
      <section>
        <h3>Event details</h3>
        <pre>{JSON.stringify(item.metadata, null, 2)}</pre>
      </section>
    </aside>
  );
}

function CaseJourney() {
  const auth = useAuth();
  const [caseId, setCaseId] = useState("");
  const [submitted, setSubmitted] = useState("");
  const query = useQuery({
    queryKey: ["audit-journey", submitted],
    enabled: Boolean(submitted),
    queryFn: async ({ signal }) => {
      const response = await auth.request(
        `/api/v1/audit/cases/${encodeURIComponent(submitted)}/journey`,
        { signal },
      );
      if (!response.ok) throw await responseProblem(response);
      return response.json() as Promise<{
        caseId: string;
        complete: boolean;
        items: (AuditRecord & { category: string; summary: string })[];
      }>;
    },
  });
  return (
    <div className="audit-pane audit-journey-pane">
      <div className="audit-section-heading">
        <div>
          <p className="eyebrow">Complete case history</p>
          <h2>Case journey</h2>
          <p>
            Enter a case ID to see its evidence, review and decision activity in
            order.
          </p>
        </div>
      </div>
      <form
        className="journey-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (caseId.trim()) setSubmitted(caseId.trim());
        }}
      >
        <label>
          <span>Case ID</span>
          <input
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
        </label>
        <button className="primary-button" type="submit">
          <FileSearch size={16} />
          Load journey
        </button>
      </form>
      {query.isError && (
        <div className="api-problem">{query.error.message}</div>
      )}
      {query.isLoading && <div className="empty-state">Loading journey…</div>}
      {query.data && (
        <ol className="audit-timeline">
          {query.data.items.map((item) => (
            <li key={item.id}>
              <span className="audit-timeline-marker">
                <Fingerprint size={15} />
              </span>
              <div>
                <header>
                  <strong>{item.eventType}</strong>
                  <StatusBadge value={item.outcome} />
                </header>
                <p>
                  {item.category} · {item.sourceService}
                </p>
                <small>{formatDate(item.occurredAt)}</small>
              </div>
            </li>
          ))}
          {!query.data.items.length && (
            <li className="empty-state">
              No activity was found for this case.
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

function ReportCenter() {
  const auth = useAuth();
  const client = useQueryClient();
  const [reportKey, setReportKey] = useState("OPERATIONAL_AUDIT_ACTIVITY");
  const [caseId, setCaseId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const catalog = useQuery({
    queryKey: ["audit-report-catalog"],
    queryFn: async () => {
      const response = await auth.request("/api/v1/audit/reports/catalog");
      if (!response.ok) throw await responseProblem(response);
      return response.json() as Promise<{
        items: {
          key: string;
          title: string;
          description: string;
          parameters: { key: string; type: string; required: boolean }[];
        }[];
      }>;
    },
  });
  const runs = useQuery({
    queryKey: ["audit-reports"],
    refetchInterval: 2_000,
    queryFn: async () => {
      const response = await auth.request("/api/v1/audit/reports");
      if (!response.ok) throw await responseProblem(response);
      return response.json() as Promise<{ items: ReportRun[] }>;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const parameters = caseId.trim() ? { caseId: caseId.trim() } : {};
      const response = await auth.request("/api/v1/audit/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ reportKey, parameters }),
      });
      if (!response.ok) throw await responseProblem(response);
      return response.json();
    },
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["audit-reports"] }),
  });
  const definition = catalog.data?.items.find((item) => item.key === reportKey);
  const caseParameter = definition?.parameters.find(
    (parameter) => parameter.key === "caseId",
  );
  return (
    <>
      <RunCenter
        eyebrow="Reports"
        title="Audit reports"
        description="Run a standard report against a fixed point in the audit history."
        action={
          <div className="audit-run-form">
            <SelectField
              label="Report"
              value={reportKey}
              onChange={(event) => {
                setReportKey(event.target.value);
                setCaseId("");
              }}
            >
              {(catalog.data?.items ?? []).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.title}
                </option>
              ))}
            </SelectField>
            {caseParameter && (
              <label>
                <span>
                  Case ID {caseParameter.required ? "(required)" : "(optional)"}
                </span>
                <input
                  value={caseId}
                  onChange={(event) => setCaseId(event.target.value)}
                  required={caseParameter.required}
                  placeholder="Scope to one case"
                />
              </label>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={() => setConfirmOpen(true)}
              disabled={
                create.isPending ||
                !definition ||
                Boolean(caseParameter?.required && !caseId.trim())
              }
            >
              <FileChartColumn size={16} />
              {create.isPending ? "Scheduling…" : "Run report"}
            </button>
          </div>
        }
        error={create.error?.message ?? runs.error?.message}
        loading={runs.isLoading}
        rows={(runs.data?.items ?? []).map((run) => ({
          ...run,
          label: run.reportKey.replaceAll("_", " "),
        }))}
        onDownload={(run) =>
          void downloadGrant(auth, `/api/v1/audit/reports/${run.id}/download`)
        }
      />
      <ConfirmationDialog
        open={confirmOpen}
        title="Run compliance report"
        description={`Create ${definition?.title ?? "the selected report"} at a fixed audit snapshot${caseId.trim() ? ` for case ${caseId.trim()}` : ""}.`}
        confirmLabel="Run report"
        busy={create.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          create.mutate(undefined, {
            onSuccess: () => setConfirmOpen(false),
          })
        }
      />
    </>
  );
}

function ExportCenter() {
  const auth = useAuth();
  const client = useQueryClient();
  const [format, setFormat] = useState("CSV");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const runs = useQuery({
    queryKey: ["audit-exports"],
    refetchInterval: 2_000,
    queryFn: async () => {
      const response = await auth.request("/api/v1/audit/exports");
      if (!response.ok) throw await responseProblem(response);
      return response.json() as Promise<{ items: ExportRun[] }>;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const response = await auth.request("/api/v1/audit/exports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ format, filters: {} }),
      });
      if (!response.ok) throw await responseProblem(response);
      return response.json();
    },
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["audit-exports"] }),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const response = await auth.request(
        `/api/v1/audit/exports/${id}/cancel`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
        },
      );
      if (!response.ok) throw await responseProblem(response);
      return response.json();
    },
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["audit-exports"] }),
  });
  return (
    <>
      <RunCenter
        eyebrow="Data export"
        title="Audit exports"
        description="Create a CSV or JSON export. Each file includes a checksum and expires after seven days."
        action={
          <div className="audit-run-form">
            <SelectField
              label="Format"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option>CSV</option>
              <option>JSON</option>
            </SelectField>
            <span className="audit-export-bound">
              Maximum 5,000 rows · 7-day retention
            </span>
            <button
              type="button"
              className="primary-button"
              onClick={() => setConfirmOpen(true)}
              disabled={create.isPending}
            >
              <Archive size={16} />
              {create.isPending ? "Scheduling…" : "Create export"}
            </button>
          </div>
        }
        error={
          create.error?.message ?? cancel.error?.message ?? runs.error?.message
        }
        loading={runs.isLoading}
        rows={(runs.data?.items ?? []).map((run) => ({
          ...run,
          label: `${run.format} audit export`,
        }))}
        onDownload={(run) =>
          void downloadGrant(auth, `/api/v1/audit/exports/${run.id}/download`)
        }
        onCancel={(run) => cancel.mutate(run.id)}
      />
      <ConfirmationDialog
        open={confirmOpen}
        title="Create audit export"
        description={`Create a ${format} export from the current audit data. The file will expire automatically.`}
        confirmLabel="Create export"
        busy={create.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          create.mutate(undefined, {
            onSuccess: () => setConfirmOpen(false),
          })
        }
      />
    </>
  );
}

async function downloadGrant(auth: ReturnType<typeof useAuth>, path: string) {
  const response = await auth.request(path);
  if (!response.ok) throw await responseProblem(response);
  const grant = (await response.json()) as { url: string };
  location.assign(grant.url);
}

function RunCenter({
  eyebrow,
  title,
  description,
  action,
  error,
  loading,
  rows,
  onDownload,
  onCancel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action: React.ReactNode;
  error?: string;
  loading: boolean;
  rows: (Run & { label: string })[];
  onDownload(run: Run): void;
  onCancel?(run: Run): void;
}) {
  return (
    <div className="audit-pane">
      <div className="audit-section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {action}
      </div>
      {error && <div className="api-problem">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading activity…</div>
      ) : (
        <div className="table-wrap">
          <table className="audit-run-table">
            <thead>
              <tr>
                <th>Artifact</th>
                <th>Requested</th>
                <th>Rows</th>
                <th>Checksum</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <tr key={run.id}>
                  <td>
                    <strong>{run.label}</strong>
                    <small>{run.artifactFilename ?? run.id}</small>
                    <small>Expires {formatDate(run.expiresAt)}</small>
                  </td>
                  <td>{formatDate(run.createdAt)}</td>
                  <td>{run.rowCount}</td>
                  <td
                    className="audit-hash-cell"
                    title={run.checksumSha256 ?? ""}
                  >
                    {run.checksumSha256 ?? "Pending"}
                  </td>
                  <td>
                    <StatusBadge value={run.state} />
                  </td>
                  <td>
                    {onCancel && run.state === "PENDING" && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onCancel(run)}
                        aria-label={`Cancel ${run.label}`}
                      >
                        <X size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      disabled={run.state !== "COMPLETED"}
                      onClick={() => onDownload(run)}
                      aria-label={`Download ${run.label}`}
                    >
                      <Download size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No runs have been requested.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuditOperations() {
  const auth = useAuth();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [pendingType, setPendingType] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["audit-operations"],
    refetchInterval: 2_000,
    queryFn: async () => {
      const response = await auth.request("/api/v1/audit/operations");
      if (!response.ok) throw await responseProblem(response);
      return response.json() as Promise<{
        auditCount: number;
        quarantineOpen: number;
        freshness: { status: string; checkpoints: unknown[] };
        jobs: (Run & { type: string; reason: string; dryRun: boolean })[];
      }>;
    },
  });
  const verify = useQuery({
    queryKey: ["audit-chain-verification"],
    queryFn: async () => {
      const response = await auth.request(
        "/api/v1/audit/chain/verify?limit=5000",
      );
      if (!response.ok) throw await responseProblem(response);
      return response.json() as Promise<{
        status: string;
        checked: number;
        verifiedAt: string;
      }>;
    },
  });
  const operate = useMutation({
    mutationFn: async (input: { type: string; reason: string }) => {
      const response = await auth.request("/api/v1/audit/operations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          type: input.type,
          dryRun: true,
          reason: input.reason,
          parameters: {},
        }),
      });
      if (!response.ok) throw await responseProblem(response);
      return response.json();
    },
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["audit-operations"] }),
  });
  if (query.isError)
    return <div className="api-problem">{query.error.message}</div>;
  return (
    <div className="audit-pane">
      <div className="audit-operation-metrics">
        <article>
          <Fingerprint size={18} />
          <strong>{query.data?.auditCount ?? "—"}</strong>
          <span>Audit records</span>
        </article>
        <article>
          <Archive size={18} />
          <strong>{query.data?.freshness.checkpoints.length ?? "—"}</strong>
          <span>Kafka checkpoints</span>
        </article>
        <article>
          <Clock3 size={18} />
          <strong>{query.data?.quarantineOpen ?? "—"}</strong>
          <span>Records needing review</span>
        </article>
        <article>
          <ShieldCheck size={18} />
          <strong>{verify.data?.status ?? "Checking"}</strong>
          <span>{verify.data?.checked ?? 0} hashes verified</span>
        </article>
      </div>
      <div className="audit-section-heading">
        <div>
          <p className="eyebrow">Maintenance tools</p>
          <h2>Audit data maintenance</h2>
          <p>
            Test a replay, index rebuild or reconciliation before applying any
            changes.
          </p>
        </div>
        <PermissionGate permission="audit:operate">
          <div className="audit-operation-control">
            <label>
              <span>Required operation reason</span>
              <input
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this operation is needed"
              />
            </label>
            <div className="audit-operation-actions">
              {["REPLAY", "PROJECTION_REBUILD", "RECONCILIATION"].map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    className="secondary-button"
                    disabled={operate.isPending || reason.trim().length < 10}
                    onClick={() => setPendingType(type)}
                  >
                    {type.replaceAll("_", " ")}
                  </button>
                ),
              )}
            </div>
          </div>
        </PermissionGate>
      </div>
      {operate.isError && (
        <div className="api-problem">{operate.error.message}</div>
      )}
      <div className="table-wrap">
        <table className="audit-run-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Reason</th>
              <th>Mode</th>
              <th>Requested</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.jobs ?? []).map((job) => (
              <tr key={job.id}>
                <td>
                  <strong>{job.type.replaceAll("_", " ")}</strong>
                </td>
                <td>{job.reason}</td>
                <td>{job.dryRun ? "Dry run" : "Apply changes"}</td>
                <td>{formatDate(job.createdAt)}</td>
                <td>
                  <StatusBadge value={job.state} />
                </td>
              </tr>
            ))}
            {!query.data?.jobs.length && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No operator jobs have been requested.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ConfirmationDialog
        open={Boolean(pendingType)}
        title={`Confirm ${pendingType?.replaceAll("_", " ").toLowerCase() ?? "operation"}`}
        description={`Test this operation without changing the current audit data. Reason: ${reason.trim()}`}
        confirmLabel="Start dry run"
        busy={operate.isPending}
        onCancel={() => setPendingType(null)}
        onConfirm={() => {
          if (!pendingType) return;
          operate.mutate(
            { type: pendingType, reason: reason.trim() },
            {
              onSuccess: () => {
                setPendingType(null);
                setReason("");
              },
            },
          );
        }}
      />
    </div>
  );
}
