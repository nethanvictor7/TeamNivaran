import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Gavel,
  ListChecks,
  Play,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionGate, useAuth } from "./auth";
import type { CaseLedgerController } from "./CaseLedger";
import { ProofStatusBadge } from "./LedgerProofs";
import { ApplicationShell } from "./ApplicationShell";
import { casePath, navigate } from "./routing";

type ValidationResult = {
  id: string;
  ruleDefinitionId: string;
  ruleType: string;
  status: string;
  messageCode: string;
};
type ValidationRun = {
  id: string;
  runNumber: number;
  status: string;
  completedAt: string;
  evidenceSnapshot: Array<{
    evidenceAssetId: string;
    evidenceVersionId: string;
    sha256: string;
    classificationCode: string;
  }>;
  results: ValidationResult[];
};
type WorkflowTask = {
  id: string;
  caseId: string;
  workflowInstanceId: string;
  taskType: string;
  status: string;
  requiredPermission: string;
  assignedUserId: string | null;
  claimedBy: string | null;
  dueAt: string | null;
  rowVersion: number;
};
type WorkflowInstance = {
  id: string;
  caseId: string;
  caseNumberSnapshot: string;
  cycleNumber: number;
  state: string;
  rowVersion: number;
  caseSyncStatus: string;
  definitionVersion: {
    id: string;
    versionNumber: number;
    definition: { name: string; code: string };
  };
  validations: ValidationRun[];
  tasks: WorkflowTask[];
  history: Array<{
    id: string;
    action: string;
    fromState: string | null;
    toState: string;
    occurredAt: string;
  }>;
  recommendations: Array<{
    id: string;
    outcome: string;
    actorId: string;
    submittedAt: string;
  }>;
  decisions: Array<{
    id: string;
    outcome: string;
    decidedBy: string;
    decidedAt: string;
  }>;
};
type WorkflowResponse = { items: WorkflowInstance[] };
type WorkflowDefinitionVersion = {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
};
type WorkflowDefinition = {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  status: string;
  isDefault: boolean;
  versions: WorkflowDefinitionVersion[];
};

async function problem(response: Response) {
  const body = await response.json().catch(() => ({}));
  return new Error(
    typeof body.detail === "string"
      ? body.detail
      : `Request failed (${response.status}).`,
  );
}

export function WorkflowStatusBadge({ status }: { status: string }) {
  const terminal = ["APPROVED", "REJECTED"].includes(status);
  const attention = [
    "EVIDENCE_REQUIRED",
    "CORRECTION_REQUESTED",
    "FAILED",
  ].includes(status);
  return (
    <span
      className={`status ${terminal && status === "APPROVED" ? "status-green" : attention ? "status-amber" : "status-blue"}`}
    >
      {terminal ? (
        <Gavel size={12} />
      ) : attention ? (
        <AlertTriangle size={12} />
      ) : (
        <Clock3 size={12} />
      )}
      {status.replaceAll("_", " ")}
    </span>
  );
}

function WorkflowStepper({ state }: { state: string }) {
  const steps = [
    "VALIDATING",
    "READY_FOR_REVIEW",
    "UNDER_REVIEW",
    "READY_FOR_RECOMMENDATION",
    "DECISION_PENDING",
    "APPROVED",
  ];
  const aliases: Record<string, number> = {
    NOT_STARTED: 0,
    EVIDENCE_REQUIRED: 0,
    CORRECTION_REQUESTED: 1,
    RECOMMENDATION_SUBMITTED: 4,
    REJECTED: 5,
  };
  const active = Math.max(0, steps.indexOf(state), aliases[state] ?? -1);
  return (
    <ol className="workflow-stepper" aria-label="Workflow progress">
      {["Validate", "Review", "Recommend", "Decide"].map((label, index) => (
        <li
          key={label}
          className={index <= Math.min(active, 3) ? "step-complete" : ""}
        >
          <span>{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

async function command(
  auth: ReturnType<typeof useAuth>,
  path: string,
  body: object,
  idempotent = false,
) {
  const response = await auth.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await problem(response);
  return response.json();
}

export function WorkflowPanel({
  caseId,
  ledger,
  onOpenLedger,
}: {
  caseId: string;
  ledger?: CaseLedgerController;
  onOpenLedger(): void;
}) {
  const auth = useAuth();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rationale, setRationale] = useState(
    "Reviewed against current evidence.",
  );
  const query = useQuery({
    queryKey: ["case-workflow", caseId],
    queryFn: async () => {
      const response = await auth.request(`/api/v1/cases/${caseId}/workflow`);
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<WorkflowResponse>;
    },
  });
  const current =
    query.data?.items.find(
      (item) =>
        !["APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED"].includes(
          item.state,
        ),
    ) ?? query.data?.items[0];
  const validation = current?.validations[0];
  const task = current?.tasks.find((item) =>
    ["PENDING", "CLAIMED"].includes(item.status),
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["case-workflow", caseId] });
      await client.invalidateQueries({ queryKey: ["workflow-tasks"] });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Workflow action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading)
    return <div className="card empty-state">Loading workflow…</div>;
  if (query.isError)
    return <div className="api-problem">{query.error.message}</div>;
  if (!current)
    return (
      <section className="card case-page-panel workflow-empty">
        <ShieldCheck size={28} />
        <h2>No workflow started</h2>
        <p>Start the checks and human review required for this type of case.</p>
        <PermissionGate permission="workflow:start">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void run(() =>
                command(
                  auth,
                  `/api/v1/cases/${caseId}/workflow/start`,
                  {},
                  true,
                ),
              )
            }
          >
            <Play size={16} /> Start workflow
          </button>
        </PermissionGate>
        {error && <div className="api-problem">{error}</div>}
      </section>
    );

  return (
    <div className="workflow-panel-stack">
      <section className="card case-page-panel">
        <div className="case-panel-header workflow-heading">
          <div>
            <p className="eyebrow">
              Cycle {current.cycleNumber} · Definition v
              {current.definitionVersion.versionNumber}
            </p>
            <h2>{current.definitionVersion.definition.name}</h2>
            <p>Required checks, review and final decision for this case.</p>
          </div>
          <WorkflowStatusBadge status={current.state} />
        </div>
        <WorkflowStepper state={current.state} />
        <div className="workflow-summary-grid">
          <div>
            <span>Validation</span>
            <strong>{validation?.status ?? "Not run"}</strong>
          </div>
          <div>
            <span>Open task</span>
            <strong>{task?.taskType.replaceAll("_", " ") ?? "None"}</strong>
          </div>
          <div>
            <span>Case update</span>
            <strong>{current.caseSyncStatus}</strong>
          </div>
          <div>
            <span>Workflow version</span>
            <strong>v{current.rowVersion}</strong>
          </div>
        </div>
        {["NOT_STARTED", "EVIDENCE_REQUIRED", "CORRECTION_REQUESTED"].includes(
          current.state,
        ) && (
          <PermissionGate permission="validation:run">
            <div className="case-panel-actions">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    command(auth, `/api/v1/cases/${caseId}/workflow/validate`, {
                      expectedVersion: current.rowVersion,
                    }),
                  )
                }
              >
                <RefreshCw size={16} /> Run validation
              </button>
            </div>
          </PermissionGate>
        )}
      </section>

      {validation && (
        <section className="card case-page-panel">
          <div className="case-panel-header">
            <div>
              <h2>Validation run {validation.runNumber}</h2>
              <p>
                {validation.evidenceSnapshot.length} evidence{" "}
                {validation.evidenceSnapshot.length === 1
                  ? "version"
                  : "versions"}{" "}
                checked
              </p>
            </div>
            <WorkflowStatusBadge status={validation.status} />
          </div>
          <div className="validation-result-list">
            {validation.results.map((result) => (
              <div className="validation-result-row" key={result.id}>
                {result.status === "PASS" ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <AlertTriangle size={17} />
                )}
                <div>
                  <strong>{result.ruleDefinitionId}</strong>
                  <span>{result.ruleType.replaceAll("_", " ")}</span>
                </div>
                <WorkflowStatusBadge status={result.status} />
              </div>
            ))}
          </div>
        </section>
      )}

      {ledger?.summary && (
        <section className="card case-page-panel">
          <div className="case-panel-header">
            <div>
              <p className="eyebrow">Decision proof</p>
              <h2>Ledger confirmation</h2>
              <p>{ledger.summary.decision.explanation}</p>
            </div>
            <ProofStatusBadge
              lifecycle={ledger.summary.decision.lifecycle}
              eligibility={ledger.summary.decision.eligibility}
            />
          </div>
          <div className="case-panel-actions">
            <button className="secondary-button" onClick={onOpenLedger}>
              Open Ledger & Verification
            </button>
          </div>
        </section>
      )}

      {task && (
        <section className="card case-page-panel">
          <div className="case-panel-header">
            <div>
              <h2>{task.taskType.replaceAll("_", " ")}</h2>
              <p>
                {task.claimedBy
                  ? "Claimed for protected human action."
                  : "Available in the organization queue."}
              </p>
            </div>
            <WorkflowStatusBadge status={task.status} />
          </div>
          {task.status === "PENDING" && (
            <PermissionGate permission="workflow:task:claim">
              <div className="case-panel-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      command(auth, `/api/v1/workflow/tasks/${task.id}/claim`, {
                        taskVersion: task.rowVersion,
                      }),
                    )
                  }
                >
                  <UserCheck size={16} /> Claim task
                </button>
              </div>
            </PermissionGate>
          )}
          {task.taskType === "REVIEW_CASE" &&
            task.claimedBy === auth.identity?.userId && (
              <PermissionGate permission="review:submit">
                <div className="workflow-action-form">
                  <label>
                    Human review rationale
                    <textarea
                      rows={3}
                      value={rationale}
                      onChange={(event) => setRationale(event.target.value)}
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy || rationale.trim().length < 3}
                    onClick={() =>
                      void run(() =>
                        command(
                          auth,
                          `/api/v1/workflow/tasks/${task.id}/submit-review`,
                          {
                            workflowVersion: current.rowVersion,
                            taskVersion: task.rowVersion,
                            outcome: "READY_FOR_RECOMMENDATION",
                            reasonCodes: ["STANDARD_REVIEW"],
                            rationale,
                            evidenceVersionIds:
                              validation?.evidenceSnapshot.map(
                                (item) => item.evidenceVersionId,
                              ) ?? [],
                          },
                        ),
                      )
                    }
                  >
                    <ClipboardCheck size={16} /> Submit human review
                  </button>
                </div>
              </PermissionGate>
            )}
          {task.taskType === "CREATE_RECOMMENDATION" && (
            <PermissionGate permission="decision:recommend">
              <div className="workflow-action-form">
                <p className="workflow-advisory-note">
                  A recommendation is advisory and is not a final decision.
                </p>
                <label>
                  Recommendation rationale
                  <textarea
                    rows={3}
                    value={rationale}
                    onChange={(event) => setRationale(event.target.value)}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      command(auth, `/api/v1/cases/${caseId}/recommendations`, {
                        workflowVersion: current.rowVersion,
                        outcome: "RECOMMEND_APPROVAL",
                        reasonCodes: ["STANDARD_REVIEW"],
                        rationale,
                        conditions: [],
                        supportingAssessmentIds: [],
                      }),
                    )
                  }
                >
                  <ListChecks size={16} /> Record recommendation
                </button>
              </div>
            </PermissionGate>
          )}
          {task.taskType === "APPROVE_DECISION" && (
            <div className="workflow-action-form">
              <p className="workflow-advisory-note">
                Four-eyes enforcement is performed again by the server at
                commit.
              </p>
              <label>
                Final decision rationale
                <textarea
                  rows={3}
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                />
              </label>
              <div className="case-panel-actions">
                <PermissionGate permission="decision:reject">
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm("Record final human rejection?"))
                        return;
                      void run(() =>
                        command(
                          auth,
                          `/api/v1/cases/${caseId}/decision/reject`,
                          {
                            workflowVersion: current.rowVersion,
                            taskVersion: task.rowVersion,
                            reasonCodes: ["ADVERSE_FINDING"],
                            rationale,
                          },
                          true,
                        ),
                      );
                    }}
                  >
                    Reject
                  </button>
                </PermissionGate>
                <PermissionGate permission="decision:approve">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm("Record final human approval?"))
                        return;
                      void run(() =>
                        command(
                          auth,
                          `/api/v1/cases/${caseId}/decision/approve`,
                          {
                            workflowVersion: current.rowVersion,
                            taskVersion: task.rowVersion,
                            reasonCodes: ["STANDARD_REVIEW"],
                            rationale,
                          },
                          true,
                        ),
                      );
                    }}
                  >
                    <Gavel size={16} /> Approve
                  </button>
                </PermissionGate>
              </div>
            </div>
          )}
        </section>
      )}

      {current.decisions[0] && (
        <section className="card workflow-decision-record">
          <Gavel size={22} />
          <div>
            <span>Final human decision</span>
            <h3>{current.decisions[0].outcome}</h3>
            <p>{new Date(current.decisions[0].decidedAt).toLocaleString()}</p>
          </div>
        </section>
      )}
      {error && <div className="api-problem">{error}</div>}
    </div>
  );
}

function WorkflowDefinitionAdmin() {
  const auth = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState("Commercial credit approval");
  const [code, setCode] = useState("COMMERCIAL-CREDIT");
  const [caseType, setCaseType] = useState("COMMERCIAL_CREDIT");
  const [classification, setClassification] = useState("APPLICATION_FORM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["workflow-definitions"],
    queryFn: async () => {
      const response = await auth.request("/api/v1/workflow-definitions");
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<WorkflowDefinition[]>;
    },
  });

  async function createPublishedDefinition() {
    setBusy(true);
    setError("");
    try {
      const definition = (await command(auth, "/api/v1/workflow-definitions", {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: "Approval workflow managed by your organisation.",
        isDefault: false,
      })) as WorkflowDefinition;
      const version = (await command(
        auth,
        `/api/v1/workflow-definitions/${definition.id}/versions`,
        {
          startMode: "MANUAL",
          warningPolicy: "NON_BLOCKING",
          fourEyesEnabled: true,
          prohibitEvidenceSubmitterApproval: false,
          prohibitReviewerApproval: false,
          defaultReviewDueHours: 24,
          defaultDecisionDueHours: 24,
          configuration: {
            caseTypes: [caseType.trim().toUpperCase()],
            requiredEvidence: [
              {
                classificationCode: classification.trim().toUpperCase(),
                minimumCount: 1,
                currentOnly: true,
              },
            ],
            rules: [
              {
                id: "required-evidence-present",
                type: "REQUIRED_EVIDENCE_PRESENT",
                classificationCode: classification.trim().toUpperCase(),
              },
              {
                id: "case-title-present",
                type: "CASE_FIELD_PRESENT",
                field: "title",
              },
            ],
            reasonCodes: [
              "STANDARD_REVIEW",
              "INFORMATION_REQUIRED",
              "POLICY_REQUIREMENT",
            ],
            reviewOutcomes: ["READY_FOR_RECOMMENDATION", "CORRECTION_REQUIRED"],
          },
        },
      )) as WorkflowDefinitionVersion;
      await command(
        auth,
        `/api/v1/workflow-definitions/${definition.id}/versions/${version.id}/publish`,
        {},
      );
      await client.invalidateQueries({ queryKey: ["workflow-definitions"] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Definition publication failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retire(
    definitionId: string,
    version: WorkflowDefinitionVersion,
  ) {
    if (!window.confirm(`Retire published version ${version.versionNumber}?`))
      return;
    setBusy(true);
    setError("");
    try {
      await command(
        auth,
        `/api/v1/workflow-definitions/${definitionId}/versions/${version.id}/retire`,
        {},
      );
      await client.invalidateQueries({ queryKey: ["workflow-definitions"] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Definition retirement failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card workflow-definition-admin">
      <div className="card-header">
        <div>
          <h2>Workflow definitions</h2>
          <p>
            Define the checks, review steps and decision rules used for each
            case type.
          </p>
        </div>
      </div>
      <div className="workflow-definition-form">
        <label>
          Definition name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label>
          Case type
          <input
            value={caseType}
            onChange={(event) => setCaseType(event.target.value)}
          />
        </label>
        <label>
          Required evidence
          <input
            value={classification}
            onChange={(event) => setClassification(event.target.value)}
          />
        </label>
        <button
          className="primary-button"
          disabled={
            busy ||
            [name, code, caseType, classification].some(
              (value) => value.trim().length < 3,
            )
          }
          onClick={() => void createPublishedDefinition()}
        >
          <ShieldCheck size={16} /> Create and publish
        </button>
      </div>
      {error && <div className="api-problem">{error}</div>}
      {query.isLoading ? (
        <div className="empty-state">Loading definitions…</div>
      ) : query.isError ? (
        <div className="api-problem">{query.error.message}</div>
      ) : (
        <div className="workflow-definition-list">
          {query.data?.map((definition) => (
            <article key={definition.id}>
              <div>
                <strong>{definition.name}</strong>
                <span>
                  {definition.code} ·{" "}
                  {definition.organizationId ? "Organization" : "Platform"}
                </span>
              </div>
              <div className="case-panel-actions">
                {definition.versions.map((version) => (
                  <span key={version.id} className="definition-version">
                    v{version.versionNumber} · {version.status}
                    {definition.organizationId &&
                      version.status === "PUBLISHED" && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void retire(definition.id, version)}
                        >
                          Retire
                        </button>
                      )}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function WorkflowOperations() {
  const auth = useAuth();
  const query = useQuery({
    queryKey: ["workflow-tasks"],
    queryFn: async () => {
      const response = await auth.request(
        "/api/v1/workflow/tasks?status=PENDING&pageSize=100",
      );
      if (!response.ok) throw await problem(response);
      return response.json() as Promise<{
        items: WorkflowTask[];
        total: number;
      }>;
    },
  });
  return (
    <ApplicationShell activeWorkspace="workflow">
      <section className="module-page workflow-operations-page">
        <div className="module-identity">
          <span className="module-identity-icon" aria-hidden="true">
            <Gavel size={22} />
          </span>
          <div>
            <p className="eyebrow">Review and decisions</p>
            <h1>Workflow queue</h1>
            <p className="page-subtitle">
              See the validation, review and decision tasks waiting for action.
            </p>
          </div>
        </div>
        <section className="card work-queue">
          <div className="card-header">
            <div>
              <h2>Open tasks</h2>
              <p>{query.data?.total ?? 0} awaiting action</p>
            </div>
          </div>
          {query.isLoading ? (
            <div className="empty-state">Loading workflow queue…</div>
          ) : query.isError ? (
            <div className="api-problem">{query.error.message}</div>
          ) : !query.data?.items.length ? (
            <div className="empty-state">No workflow tasks need attention.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Required permission</th>
                    <th>Due</th>
                    <th>Case</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <strong>{task.taskType.replaceAll("_", " ")}</strong>
                      </td>
                      <td>
                        <WorkflowStatusBadge status={task.status} />
                      </td>
                      <td>{task.requiredPermission}</td>
                      <td>
                        {task.dueAt
                          ? new Date(task.dueAt).toLocaleString()
                          : "No due date"}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            navigate(casePath(task.caseId, "workflow"))
                          }
                        >
                          Open case
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <PermissionGate permission="workflow:definition:manage">
          <WorkflowDefinitionAdmin />
        </PermissionGate>
      </section>
    </ApplicationShell>
  );
}
