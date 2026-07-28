import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  FileCheck2,
  Gauge,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionGate, useAuth } from "./auth";
import { ConfirmationDialog, CopyIdentifier, StatusBadge } from "./ui";

type AssessmentSummary = {
  id: string;
  caseId: string;
  status: string;
  purpose: string;
  requestedAt: string;
  completedAt: string | null;
  statusReasonCode: string | null;
};
type OutputItem = {
  code: string;
  title?: string;
  detail?: string;
  label?: string;
  severity?: string;
  required?: boolean;
};
type AssessmentDetail = AssessmentSummary & {
  workflowVersion: number;
  output: null | {
    summary: string;
    recommendation: string;
    confidence: number;
    findings: OutputItem[];
    missingInformation: OutputItem[];
    riskIndicators: OutputItem[];
    citations: Array<{
      code: string;
      evidenceAssetId: string;
      evidenceVersionId: string;
    }>;
  };
  refs: Array<{
    evidenceAssetId: string;
    evidenceVersionId: string;
    classificationCode: string;
    sha256: string;
  }>;
};
type WorkflowResponse = {
  items: Array<{ id: string; state: string; rowVersion: number }>;
};
type Governance = {
  adapterMode: string;
  liveCortex: string;
  runtimeConfigs: RuntimeConfig[];
  modelPolicies: ModelPolicy[];
  promptTemplates: Array<{
    id: string;
    code: string;
    name: string;
    versions: Array<{ id: string; versionNumber: number; status: string }>;
  }>;
  redactionPolicies: Array<{ id: string; code: string; enabled: boolean }>;
  killSwitches: KillSwitch[];
};

type RuntimeConfig = {
  id: string;
  organizationId: string | null;
  code: string;
  mockProfile: string;
  enabled: boolean;
  maxInputBytes: number;
  maxEvidenceItems: number;
  timeoutMs: number;
  retryLimit: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type ModelPolicy = {
  id: string;
  organizationId: string | null;
  code: string;
  enabled: boolean;
  runtimeConfigId: string;
  promptTemplateVersionId: string;
  allowedClassifications: string[];
  allowedMediaTypes: string[];
  purpose: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type KillSwitch = {
  id: string;
  scope: string;
  enabled: boolean;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
};

type RuntimeTestResult = {
  status: string;
  latencyCategory?: string;
  warning?: string;
};

export function formatGovernanceBytes(value: number) {
  if (value >= 1024 * 1024)
    return `${(value / (1024 * 1024)).toFixed(value % (1024 * 1024) ? 1 : 0)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

export function runtimeOutcomeLabel(profile: string) {
  return profile.replaceAll("_", " ");
}

async function problem(response: Response) {
  const body = await response.json().catch(() => ({}));
  return new Error(
    typeof body.detail === "string"
      ? body.detail
      : `Request failed (${response.status}).`,
  );
}

export function AiAssessmentPanel({ caseId }: { caseId: string }) {
  const auth = useAuth();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const assessments = useQuery({
    queryKey: ["ai-assessments", caseId],
    queryFn: async ({ signal }) => {
      const response = await auth.request(
        `/api/v1/cases/${caseId}/ai-assessments`,
        { signal },
      );
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<AssessmentSummary[]>;
    },
    refetchInterval: ({ state }) =>
      (state.data as AssessmentSummary[] | undefined)?.some((item) =>
        [
          "QUEUED",
          "PREPARING_INPUT",
          "READY_FOR_INFERENCE",
          "SUBMITTED",
          "RUNNING",
          "VALIDATING_OUTPUT",
          "CANCEL_REQUESTED",
        ].includes(item.status),
      )
        ? 1000
        : false,
  });
  const selected = selectedId ?? assessments.data?.[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ["ai-assessment", selected],
    queryFn: async ({ signal }) => {
      const response = await auth.request(
        `/api/v1/ai-assessments/${selected}`,
        {
          signal,
        },
      );
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<AssessmentDetail>;
    },
    enabled: Boolean(selected),
    refetchInterval: ({ state }) =>
      state.data &&
      [
        "QUEUED",
        "PREPARING_INPUT",
        "READY_FOR_INFERENCE",
        "SUBMITTED",
        "RUNNING",
        "VALIDATING_OUTPUT",
        "CANCEL_REQUESTED",
      ].includes((state.data as AssessmentDetail).status)
        ? 1000
        : false,
  });
  const workflow = useQuery({
    queryKey: ["case-workflow", caseId],
    queryFn: async ({ signal }) => {
      const response = await auth.request(`/api/v1/cases/${caseId}/workflow`, {
        signal,
      });
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<WorkflowResponse>;
    },
  });
  const currentWorkflow = workflow.data?.items.find(
    (item) =>
      !["APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED"].includes(item.state),
  );
  async function post(path: string, body: object, idempotent = false) {
    setOperationBusy(true);
    setMessage("");
    try {
      const response = await auth.request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = await problem(response);
        setMessage(error.message);
        return null;
      }
      await client.invalidateQueries({ queryKey: ["ai-assessments", caseId] });
      await client.invalidateQueries({ queryKey: ["ai-assessment", selected] });
      return response.json();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The assessment operation could not be completed.",
      );
      return null;
    } finally {
      setOperationBusy(false);
    }
  }
  const output = detail.data?.output;
  return (
    <div className="ai-assessment-layout">
      <section className="card case-page-panel ai-assessment-register">
        <div className="case-panel-header">
          <div>
            <p className="eyebrow">Decision support · Human controlled</p>
            <h2>AI assessments</h2>
            <p>
              Deterministic mock inference over exact, pinned Evidence versions.
              It cannot submit or approve a decision.
            </p>
          </div>
          <BrainCircuit size={25} />
        </div>
        <PermissionGate permission="assessment:request">
          <span className="disabled-action assessment-request-action">
            <button
              className="primary-button"
              disabled={!currentWorkflow || operationBusy}
              aria-describedby={
                !currentWorkflow ? "assessment-request-help" : undefined
              }
              onClick={() =>
                void post(
                  `/api/v1/cases/${caseId}/ai-assessments`,
                  {
                    modelPolicyId: "50000000-0000-4000-8000-000000000004",
                    purpose: "Controlled human review support",
                    expectedWorkflowVersion: currentWorkflow?.rowVersion,
                  },
                  true,
                )
              }
            >
              <Sparkles size={16} />{" "}
              {operationBusy ? "Requesting…" : "Request assessment"}
            </button>
            {!currentWorkflow && (
              <small id="assessment-request-help">
                An active Workflow is required before requesting an assessment.
              </small>
            )}
          </span>
        </PermissionGate>
        <div className="ai-assessment-list">
          {assessments.isLoading ? (
            <p className="muted-cell">Loading assessments…</p>
          ) : assessments.data?.length ? (
            assessments.data.map((item) => (
              <button
                key={item.id}
                className={`ai-assessment-row ${selected === item.id ? "ai-assessment-row-active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span>
                  <strong>{item.purpose}</strong>
                  <small>{new Date(item.requestedAt).toLocaleString()}</small>
                </span>
                <StatusBadge value={item.status} />
              </button>
            ))
          ) : assessments.isError ? (
            <div className="api-problem" role="alert">
              {assessments.error.message}
            </div>
          ) : (
            <div className="empty-state compact-empty">
              No assessment has been requested.
            </div>
          )}
        </div>
      </section>

      <section className="card case-page-panel ai-assessment-detail">
        {detail.isLoading ? (
          <div className="empty-state" role="status">
            Loading assessment result…
          </div>
        ) : detail.isError ? (
          <div className="api-problem" role="alert">
            {detail.error.message}
          </div>
        ) : !detail.data ? (
          <div className="empty-state">Select an assessment to inspect it.</div>
        ) : (
          <>
            <div className="case-panel-header">
              <div>
                <p className="eyebrow">
                  Assessment {detail.data.id.slice(0, 8)}
                </p>
                <h2>Assessment result</h2>
              </div>
              <StatusBadge value={detail.data.status} />
            </div>
            {detail.data.statusReasonCode && (
              <div className="workflow-advisory-note">
                {detail.data.statusReasonCode.replaceAll("_", " ")}
              </div>
            )}
            {output && (
              <>
                <div className="ai-result-summary">
                  <strong>{output.recommendation.replaceAll("_", " ")}</strong>
                  <span>{output.confidence}% synthetic confidence</span>
                  <p>{output.summary}</p>
                </div>
                {[
                  ["Findings", output.findings],
                  ["Missing information", output.missingInformation],
                  ["Risk indicators", output.riskIndicators],
                ].map(([label, items]) => (
                  <div className="detail-section" key={label as string}>
                    <h3>{label as string}</h3>
                    {(items as OutputItem[]).length ? (
                      (items as OutputItem[]).map((item) => (
                        <div className="control-row" key={item.code}>
                          <span>{item.title ?? item.label}</span>
                          <strong>{item.code}</strong>
                          {item.detail && <small>{item.detail}</small>}
                        </div>
                      ))
                    ) : (
                      <p className="muted-cell">None reported.</p>
                    )}
                  </div>
                ))}
                <div className="ai-human-boundary">
                  <ShieldAlert size={18} />
                  <p>
                    Accepting selected items only creates a Workflow draft with
                    provenance. A human must still review and submit it.
                  </p>
                </div>
                <div className="case-panel-actions">
                  <PermissionGate permission="assessment:feedback">
                    <button
                      className="secondary-button"
                      disabled={operationBusy}
                      onClick={() =>
                        void post(
                          `/api/v1/ai-assessments/${detail.data.id}/feedback`,
                          {
                            rating: "HELPFUL",
                            comment: "Reviewed by a human.",
                          },
                        )
                      }
                    >
                      Mark helpful
                    </button>
                  </PermissionGate>
                  <PermissionGate permission="assessment:accept">
                    <button
                      className="primary-button"
                      disabled={
                        operationBusy || !currentWorkflow || !output.findings[0]
                      }
                      onClick={() =>
                        void post(
                          `/api/v1/ai-assessments/${detail.data.id}/acceptance`,
                          {
                            expectedWorkflowVersion:
                              currentWorkflow?.rowVersion,
                            selectedItems: output.findings[0]
                              ? [
                                  {
                                    itemType: "FINDING",
                                    itemCode: output.findings[0].code,
                                  },
                                ]
                              : [],
                          },
                        )
                      }
                    >
                      Accept first finding to draft
                    </button>
                  </PermissionGate>
                </div>
              </>
            )}
            {!output && (
              <div
                className="empty-state assessment-output-state"
                role="status"
              >
                {["FAILED", "INVALID_OUTPUT", "POLICY_BLOCKED"].includes(
                  detail.data.status,
                )
                  ? "No assessment output is available for this terminal state."
                  : detail.data.status === "CANCELLED"
                    ? "This assessment was cancelled before an output was produced."
                    : "The assessment is still processing. Results will appear here when validation completes."}
              </div>
            )}
            {[
              "QUEUED",
              "PREPARING_INPUT",
              "READY_FOR_INFERENCE",
              "SUBMITTED",
              "RUNNING",
            ].includes(detail.data.status) && (
              <PermissionGate permission="assessment:cancel">
                <button
                  className="secondary-button"
                  disabled={operationBusy}
                  onClick={() =>
                    void post(
                      `/api/v1/ai-assessments/${detail.data.id}/cancel`,
                      {},
                    )
                  }
                >
                  Cancel assessment
                </button>
              </PermissionGate>
            )}
            <div className="detail-section">
              <h3>Pinned Evidence</h3>
              <div className="assessment-evidence-list">
                {detail.data.refs.map((ref) => (
                  <div
                    className="assessment-evidence-row"
                    key={ref.evidenceVersionId}
                  >
                    <strong>{ref.classificationCode}</strong>
                    <CopyIdentifier
                      value={ref.evidenceVersionId}
                      prefix="Version"
                    />
                    <CopyIdentifier value={ref.sha256} prefix="SHA-256" />
                  </div>
                ))}
                {!detail.data.refs.length && (
                  <div className="empty-state compact-empty">
                    No Evidence versions were pinned.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        {message && <div className="api-problem">{message}</div>}
      </section>
    </div>
  );
}

export function AiGovernanceWorkspace() {
  const auth = useAuth();
  const client = useQueryClient();
  const [view, setView] = useState<"overview" | "runtimes">("overview");
  const [policySearch, setPolicySearch] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(
    null,
  );
  const [runtimeTest, setRuntimeTest] = useState<RuntimeTestResult | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["ai-governance"],
    queryFn: async ({ signal }) => {
      const response = await auth.request("/api/v1/ai-governance", { signal });
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<Governance>;
    },
  });

  const filteredPolicies = useMemo(() => {
    const search = policySearch.trim().toLowerCase();
    return (query.data?.modelPolicies ?? []).filter(
      (policy) =>
        (!enabledOnly || policy.enabled) &&
        (!search ||
          policy.code.toLowerCase().includes(search) ||
          policy.purpose.toLowerCase().includes(search)),
    );
  }, [enabledOnly, policySearch, query.data?.modelPolicies]);

  const selectedPolicy =
    filteredPolicies.find((policy) => policy.id === selectedPolicyId) ??
    filteredPolicies[0] ??
    null;
  const selectedRuntime =
    query.data?.runtimeConfigs.find(
      (runtime) => runtime.id === selectedRuntimeId,
    ) ??
    query.data?.runtimeConfigs[0] ??
    null;
  const runtimeById = new Map(
    query.data?.runtimeConfigs.map((runtime) => [runtime.id, runtime]) ?? [],
  );

  async function setGlobal(enabled: boolean) {
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      const response = await auth.request(
        "/api/v1/ai-governance/kill-switches",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope: "GLOBAL",
            enabled,
            reason: enabled
              ? "Administrator-controlled pause"
              : "Operations restored",
          }),
        },
      );
      if (!response.ok) {
        setMessage((await problem(response)).message);
        setMessageError(true);
        return;
      }
      setMessage(
        enabled
          ? "Global processing pause enabled."
          : "Global processing restored.",
      );
      setConfirmPause(false);
      await client.invalidateQueries({ queryKey: ["ai-governance"] });
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The emergency control could not be updated.",
      );
      setMessageError(true);
    } finally {
      setBusy(false);
    }
  }

  async function testRuntime(runtime: RuntimeConfig) {
    setBusy(true);
    setMessage("");
    setMessageError(false);
    setRuntimeTest(null);
    try {
      const response = await auth.request(
        `/api/v1/ai-governance/cortex-configurations/${runtime.id}/test`,
        { method: "POST", body: "{}" },
      );
      if (!response.ok) {
        setMessage((await problem(response)).message);
        setMessageError(true);
        return;
      }
      const result = (await response.json()) as RuntimeTestResult;
      setRuntimeTest(result);
      setMessage(`${runtime.code} completed its deterministic self-test.`);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The runtime self-test could not be completed.",
      );
      setMessageError(true);
    } finally {
      setBusy(false);
    }
  }

  const globallyPaused = Boolean(
    query.data?.killSwitches.some(
      (switchItem) => switchItem.scope === "GLOBAL" && switchItem.enabled,
    ),
  );

  const activePolicies =
    query.data?.modelPolicies.filter((policy) => policy.enabled).length ?? 0;
  const activeRuntimes =
    query.data?.runtimeConfigs.filter((runtime) => runtime.enabled).length ?? 0;
  const publishedValidators =
    query.data?.promptTemplates.reduce(
      (count, template) =>
        count +
        template.versions.filter((version) => version.status === "PUBLISHED")
          .length,
      0,
    ) ?? 0;
  const activeRedactionPolicies =
    query.data?.redactionPolicies.filter((policy) => policy.enabled).length ??
    0;
  const delayedRuntimes =
    query.data?.runtimeConfigs.filter((runtime) =>
      ["DELAYED_RESULT", "TIMEOUT", "TRANSIENT_FAILURE"].includes(
        runtime.mockProfile,
      ),
    ).length ?? 0;
  const invalidSchemaRuntimes =
    query.data?.runtimeConfigs.filter((runtime) =>
      ["INVALID_JSON", "INVALID_SCHEMA", "BAD_CITATION"].includes(
        runtime.mockProfile,
      ),
    ).length ?? 0;

  const feedback = message ? (
    <div
      className={messageError ? "api-problem" : "operation-success"}
      role={messageError ? "alert" : "status"}
      aria-live="polite"
    >
      {message}
    </div>
  ) : null;

  return (
    <section
      className="governance-page ai-governance-page"
      aria-labelledby="governance-title"
    >
      {query.isLoading ? (
        <div className="card empty-state" role="status">
          Loading governance…
        </div>
      ) : query.isError ? (
        <div className="api-problem" role="alert">
          {query.error.message}
        </div>
      ) : query.data ? (
        view === "overview" ? (
          <>
            <header className="ai-governance-hero">
              <span className="ai-governance-hero-icon" aria-hidden="true">
                <BrainCircuit size={28} />
              </span>
              <div>
                <h1 id="governance-title">AI governance</h1>
                <p>Controlled decision support</p>
              </div>
              <StatusBadge
                value={globallyPaused ? "PROCESSING PAUSED" : "CONTROLLED"}
                tone={globallyPaused ? "danger" : "success"}
              />
            </header>

            <section
              className="card ai-governance-metrics"
              aria-label="Governance overview"
            >
              <article>
                <span className="ai-metric-icon">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <strong>{query.data.modelPolicies.length}</strong>
                  <span>Model policies</span>
                  <small>{activePolicies} enabled</small>
                </div>
              </article>
              <article>
                <span className="ai-metric-icon">
                  <Database size={22} />
                </span>
                <div>
                  <strong>{publishedValidators}</strong>
                  <span>Schema validators</span>
                  <small>{publishedValidators} published</small>
                </div>
              </article>
              <button
                type="button"
                onClick={() => setView("runtimes")}
                aria-label="Open runtime profiles"
              >
                <span className="ai-metric-icon">
                  <Gauge size={22} />
                </span>
                <div>
                  <strong>{query.data.runtimeConfigs.length}</strong>
                  <span>Runtime profiles</span>
                  <small>{activeRuntimes} active</small>
                </div>
                <ChevronRight size={17} />
              </button>
              <article>
                <span className="ai-metric-icon">
                  <FileCheck2 size={22} />
                </span>
                <div>
                  <strong>{activeRedactionPolicies}</strong>
                  <span>Protection rules</span>
                  <small>{activeRedactionPolicies} enforced</small>
                </div>
              </article>
            </section>

            <div className="ai-governance-dashboard">
              <aside className="card ai-adapter-panel">
                <div className="ai-panel-title">
                  <Activity size={18} />
                  <h2>Adapter boundary</h2>
                </div>
                <dl>
                  <div>
                    <dt>Active adapter</dt>
                    <dd>
                      <StatusBadge value={query.data.adapterMode} />
                    </dd>
                  </div>
                  <div>
                    <dt>Live Cortex integration</dt>
                    <dd className="ai-warning-value">
                      {query.data.liveCortex.replaceAll("_", " ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Runtime profiles</dt>
                    <dd>{activeRuntimes} active</dd>
                  </div>
                  <div>
                    <dt>Platform boundary</dt>
                    <dd>Human decision required</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="ai-text-action"
                  onClick={() => setView("runtimes")}
                >
                  View runtime profiles <ChevronRight size={15} />
                </button>
              </aside>

              <section className="card ai-policy-register">
                <header className="ai-panel-header">
                  <div>
                    <h2>Model policies</h2>
                    <StatusBadge value={`${activePolicies} ENABLED`} />
                  </div>
                  <div className="ai-policy-tools">
                    <label className="ai-search-control">
                      <Search size={16} aria-hidden="true" />
                      <span className="sr-only">Search policies</span>
                      <input
                        value={policySearch}
                        onChange={(event) =>
                          setPolicySearch(event.target.value)
                        }
                        placeholder="Search policies"
                      />
                    </label>
                    <button
                      type="button"
                      className={`icon-button ${enabledOnly ? "ai-filter-active" : ""}`}
                      onClick={() => setEnabledOnly((value) => !value)}
                      aria-label={
                        enabledOnly
                          ? "Show all policies"
                          : "Show enabled policies only"
                      }
                      aria-pressed={enabledOnly}
                    >
                      <SlidersHorizontal size={16} />
                    </button>
                  </div>
                </header>
                <div className="table-wrap ai-governance-table-wrap">
                  <table className="ai-governance-table">
                    <thead>
                      <tr>
                        <th scope="col">Policy name</th>
                        <th scope="col">Purpose</th>
                        <th scope="col">Runtime</th>
                        <th scope="col">State</th>
                        <th scope="col">Scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPolicies.map((policy) => (
                        <tr
                          key={policy.id}
                          className={
                            selectedPolicy?.id === policy.id
                              ? "ai-table-row-selected"
                              : undefined
                          }
                        >
                          <td>
                            <button
                              type="button"
                              className="ai-table-select"
                              onClick={() => setSelectedPolicyId(policy.id)}
                            >
                              {policy.code}
                            </button>
                          </td>
                          <td>{policy.purpose}</td>
                          <td>
                            {runtimeById.get(policy.runtimeConfigId)?.code ??
                              "Unavailable"}
                          </td>
                          <td>
                            <StatusBadge
                              value={policy.enabled ? "ENABLED" : "DISABLED"}
                            />
                          </td>
                          <td>
                            {policy.organizationId ? "Organization" : "Global"}
                          </td>
                        </tr>
                      ))}
                      {!filteredPolicies.length && (
                        <tr>
                          <td colSpan={5} className="muted-cell">
                            No policies match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <footer className="ai-table-footer">
                  Showing {filteredPolicies.length} of{" "}
                  {query.data.modelPolicies.length} policies
                </footer>
              </section>

              <aside className="card ai-policy-detail">
                <div className="ai-panel-title">
                  <ShieldCheck size={18} />
                  <h2>Policy controls</h2>
                </div>
                {selectedPolicy ? (
                  <>
                    <div className="ai-policy-code-row">
                      <CopyIdentifier value={selectedPolicy.code} />
                      <StatusBadge
                        value={selectedPolicy.enabled ? "ENABLED" : "DISABLED"}
                      />
                    </div>
                    <dl>
                      <div>
                        <dt>Scope</dt>
                        <dd>
                          {selectedPolicy.organizationId
                            ? "Organization"
                            : "Global"}
                        </dd>
                      </div>
                      <div>
                        <dt>Purpose</dt>
                        <dd>{selectedPolicy.purpose}</dd>
                      </div>
                      <div>
                        <dt>Runtime</dt>
                        <dd>
                          {runtimeById.get(selectedPolicy.runtimeConfigId)
                            ?.code ?? "Unavailable"}
                        </dd>
                      </div>
                    </dl>
                    <div className="ai-policy-rules">
                      <h3>Permitted Evidence</h3>
                      <div>
                        {selectedPolicy.allowedClassifications.map((value) => (
                          <span key={value}>{value.replaceAll("_", " ")}</span>
                        ))}
                      </div>
                      <h3>Accepted media</h3>
                      <div>
                        {selectedPolicy.allowedMediaTypes.map((value) => (
                          <span key={value}>{value}</span>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-state compact-empty">
                    Select a policy to inspect its controls.
                  </div>
                )}
              </aside>
            </div>
            {feedback}
          </>
        ) : (
          <>
            <nav className="ai-workspace-breadcrumb" aria-label="Breadcrumb">
              <button type="button" onClick={() => setView("overview")}>
                AI governance
              </button>
              <span aria-hidden="true">/</span>
              <span>Runtime profiles</span>
            </nav>
            <header className="ai-runtime-heading">
              <button
                type="button"
                className="icon-button"
                onClick={() => setView("overview")}
                aria-label="Back to AI governance"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h1 id="governance-title">Runtime profiles</h1>
                <p>Deterministic execution</p>
              </div>
            </header>

            <div className="ai-runtime-workspace">
              <section className="card ai-runtime-register">
                <div
                  className="ai-runtime-metrics"
                  aria-label="Runtime profile overview"
                >
                  <div>
                    <strong>{query.data.runtimeConfigs.length}</strong>
                    <span>Total profiles</span>
                  </div>
                  <div>
                    <strong>{activeRuntimes}</strong>
                    <span>
                      <i className="ai-dot ai-dot-success" /> Enabled
                    </span>
                  </div>
                  <div>
                    <strong>{delayedRuntimes}</strong>
                    <span>
                      <i className="ai-dot ai-dot-warning" /> Delayed
                    </span>
                  </div>
                  <div>
                    <strong>{invalidSchemaRuntimes}</strong>
                    <span>
                      <i className="ai-dot ai-dot-danger" /> Invalid schema
                    </span>
                  </div>
                </div>
                <div className="table-wrap ai-runtime-table-wrap">
                  <table className="ai-governance-table ai-runtime-table">
                    <thead>
                      <tr>
                        <th scope="col">Profile</th>
                        <th scope="col">Outcome / type</th>
                        <th scope="col">Timeout</th>
                        <th scope="col">State</th>
                        <th scope="col">Evidence limit</th>
                        <th scope="col">Retries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.runtimeConfigs.map((runtime) => (
                        <tr
                          key={runtime.id}
                          className={
                            selectedRuntime?.id === runtime.id
                              ? "ai-table-row-selected"
                              : undefined
                          }
                        >
                          <td>
                            <button
                              type="button"
                              className="ai-table-select"
                              onClick={() => {
                                setSelectedRuntimeId(runtime.id);
                                setRuntimeTest(null);
                              }}
                            >
                              {runtime.code}
                            </button>
                          </td>
                          <td>{runtimeOutcomeLabel(runtime.mockProfile)}</td>
                          <td>{runtime.timeoutMs / 1000}s</td>
                          <td>
                            <StatusBadge
                              value={runtime.enabled ? "ENABLED" : "DISABLED"}
                            />
                          </td>
                          <td>{runtime.maxEvidenceItems}</td>
                          <td>{runtime.retryLimit}</td>
                        </tr>
                      ))}
                      {!query.data.runtimeConfigs.length && (
                        <tr>
                          <td colSpan={6} className="muted-cell">
                            No deterministic runtime profiles are configured.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <footer className="ai-table-footer">
                  {query.data.runtimeConfigs.length} runtime{" "}
                  {query.data.runtimeConfigs.length === 1
                    ? "profile"
                    : "profiles"}
                </footer>
              </section>

              <aside className="ai-runtime-sidebar">
                <section className="card ai-runtime-detail">
                  <div className="ai-detail-heading">
                    <span>
                      <Gauge size={22} />
                    </span>
                    <div>
                      <h2>Runtime profile details</h2>
                      <p>Deterministic configuration and testing</p>
                    </div>
                  </div>
                  {selectedRuntime ? (
                    <>
                      <dl>
                        <div>
                          <dt>Profile</dt>
                          <dd>
                            <CopyIdentifier value={selectedRuntime.code} />
                          </dd>
                        </div>
                        <div>
                          <dt>Outcome / type</dt>
                          <dd>
                            {runtimeOutcomeLabel(selectedRuntime.mockProfile)}
                          </dd>
                        </div>
                        <div>
                          <dt>Scope</dt>
                          <dd>
                            {selectedRuntime.organizationId
                              ? "Organization"
                              : "Global"}
                          </dd>
                        </div>
                        <div>
                          <dt>Timeout</dt>
                          <dd>{selectedRuntime.timeoutMs / 1000}s</dd>
                        </div>
                        <div>
                          <dt>Input limit</dt>
                          <dd>
                            {formatGovernanceBytes(
                              selectedRuntime.maxInputBytes,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>State</dt>
                          <dd>
                            <StatusBadge
                              value={
                                selectedRuntime.enabled ? "ENABLED" : "DISABLED"
                              }
                            />
                          </dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>
                            {new Date(
                              selectedRuntime.updatedAt,
                            ).toLocaleString()}
                          </dd>
                        </div>
                      </dl>
                      <div className="ai-runtime-test">
                        <h3>Test action</h3>
                        <p>
                          Run this profile in isolation to verify deterministic
                          execution.
                        </p>
                        <PermissionGate permission="ai-governance:test">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => void testRuntime(selectedRuntime)}
                          >
                            <Play size={15} />
                            {busy ? "Running…" : "Run test"}
                          </button>
                        </PermissionGate>
                        {runtimeTest && (
                          <div className="ai-runtime-test-result" role="status">
                            <CheckCircle2 size={16} />
                            <span>
                              {runtimeTest.status}
                              {runtimeTest.latencyCategory
                                ? ` · ${runtimeTest.latencyCategory} latency`
                                : ""}
                            </span>
                            {runtimeTest.warning && (
                              <small>{runtimeTest.warning}</small>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state compact-empty">
                      Select a runtime profile to inspect it.
                    </div>
                  )}
                </section>

                <section
                  className={`card ai-global-processing ${globallyPaused ? "ai-global-processing-paused" : ""}`}
                >
                  <div className="ai-detail-heading">
                    <span>
                      <ShieldAlert size={22} />
                    </span>
                    <div>
                      <h2>Global processing</h2>
                      <p>Emergency control</p>
                    </div>
                    <StatusBadge
                      value={globallyPaused ? "PAUSED" : "AVAILABLE"}
                      tone={globallyPaused ? "danger" : "success"}
                    />
                  </div>
                  <dl>
                    <div>
                      <dt>Assessment processing</dt>
                      <dd>{globallyPaused ? "Paused" : "Available"}</dd>
                    </div>
                    <div>
                      <dt>Active runtime profiles</dt>
                      <dd>{activeRuntimes}</dd>
                    </div>
                    <div>
                      <dt>Control scope</dt>
                      <dd>Organization</dd>
                    </div>
                  </dl>
                  <div className="ai-emergency-warning">
                    <AlertTriangle size={17} />
                    <div>
                      <strong>
                        Enabling global pause stops new assessment processing.
                      </strong>
                      <span>This action requires confirmation.</span>
                    </div>
                  </div>
                  <PermissionGate permission="ai-governance:kill-switch">
                    <div className="ai-global-actions">
                      <button
                        type="button"
                        className="danger-button"
                        disabled={busy || globallyPaused}
                        onClick={() => setConfirmPause(true)}
                      >
                        Enable global pause
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy || !globallyPaused}
                        onClick={() => void setGlobal(false)}
                      >
                        Restore processing
                      </button>
                    </div>
                  </PermissionGate>
                </section>
              </aside>
            </div>
            {feedback}
          </>
        )
      ) : null}
      <ConfirmationDialog
        open={confirmPause}
        title="Pause all assessment processing?"
        description="This blocks new assessment work across the organization until an authorized operator restores processing. Existing human decisions and stored assessment results are not changed."
        confirmLabel="Enable global pause"
        busy={busy}
        onCancel={() => setConfirmPause(false)}
        onConfirm={() => void setGlobal(true)}
      />
    </section>
  );
}
