import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BriefcaseBusiness,
  Cable,
  Database,
  History,
  Landmark,
  LogOut,
  Plus,
  X,
} from "lucide-react";
import { PermissionGate, useAuth } from "./auth";

type Source = {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: string;
  version: number;
  updatedAt: string;
};
type Connector = {
  id: string;
  connectorKey: string;
  sourceSystemId: string;
  name: string;
  type: "WEBHOOK" | "SQL_POLL";
  triggerType: string;
  status: string;
  version: number;
  configurationJson: any;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  credential?: { configured: boolean };
};
type Trigger = {
  id: string;
  connectorType: string;
  triggerType: string;
  sourceRecordId?: string;
  status: string;
  receivedAt: string;
  correlationId: string;
  caseId?: string;
  lastErrorCode?: string;
};
type Run = {
  id: string;
  connectorId: string;
  status: string;
  rowsCaptured: number;
  startedAt: string;
  completedAt?: string;
  checkpointAfter?: { watermark: string; tieBreaker: string };
  errorCode?: string;
};
const jsonHeaders = { "content-type": "application/json" };

export function RevisedIntegrationWorkspace({ onCases }: { onCases(): void }) {
  const auth = useAuth(),
    client = useQueryClient(),
    [tab, setTab] = useState<"sources" | "triggers" | "runs">("sources"),
    [selectedSource, setSelectedSource] = useState<Source | null>(null),
    [selectedTrigger, setSelectedTrigger] = useState<Trigger | null>(null),
    [createSource, setCreateSource] = useState(false);
  const sources = useQuery({
    queryKey: ["integration-sources-v2"],
    queryFn: () => api<Source[]>(auth, "/api/v1/integration/sources"),
  });
  const triggers = useQuery({
    queryKey: ["integration-triggers"],
    queryFn: () =>
      api<Trigger[]>(auth, "/api/v1/integration/triggers?limit=100"),
    enabled: tab === "triggers",
  });
  const runs = useQuery({
    queryKey: ["integration-runs"],
    queryFn: () => api<Run[]>(auth, "/api/v1/integration/runs"),
    enabled: tab === "runs",
  });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <p className="nav-label">Workspace</p>
        <button className="nav-item" onClick={onCases}>
          <BriefcaseBusiness size={18} />
          <span>Decision cases</span>
        </button>
        <button
          className={`nav-item ${tab === "sources" ? "nav-item-active" : ""}`}
          onClick={() => setTab("sources")}
        >
          <Cable size={18} />
          <span>Source systems</span>
        </button>
        <button
          className={`nav-item ${tab === "triggers" ? "nav-item-active" : ""}`}
          onClick={() => setTab("triggers")}
        >
          <Activity size={18} />
          <span>Trigger monitor</span>
        </button>
        <button
          className={`nav-item ${tab === "runs" ? "nav-item-active" : ""}`}
          onClick={() => setTab("runs")}
        >
          <History size={18} />
          <span>SQL run history</span>
        </button>
        <div className="sidebar-footer">
          <div className="environment-row">
            <span className="environment-dot" />
            Integration operations
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar glass-panel">
          <strong>Integration administration</strong>
          <div className="topbar-actions">
            <span className="profile-copy">
              <strong>{auth.identity?.displayName}</strong>
              <small>{auth.identity?.email}</small>
            </span>
            <button className="icon-button" onClick={() => void auth.logout()}>
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {tab === "sources" && (
          <>
            <Heading
              eyebrow="Phase 2B · governed inputs"
              title="Source systems"
              subtitle="Configure opaque JSON webhooks and read-only PostgreSQL polling."
              action={
                <PermissionGate permission="integration:source:manage">
                  <button
                    className="primary-button"
                    onClick={() => setCreateSource(true)}
                  >
                    <Plus size={18} />
                    New source
                  </button>
                </PermissionGate>
              }
            />
            <DataCard
              loading={sources.isLoading}
              error={sources.error}
              empty={!sources.data?.length}
              emptyText="No source systems configured."
            >
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Version</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.data?.map((s) => (
                    <tr key={s.id} onClick={() => setSelectedSource(s)}>
                      <td>
                        <button className="case-link">
                          <strong>{s.name}</strong>
                          <span>{s.description || "External source"}</span>
                        </button>
                      </td>
                      <td>{s.code}</td>
                      <td>
                        <Status value={s.status} />
                      </td>
                      <td>v{s.version}</td>
                      <td>{new Date(s.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataCard>
          </>
        )}
        {tab === "triggers" && (
          <>
            <Heading
              eyebrow="Immutable source inputs"
              title="Trigger monitor"
              subtitle="Webhook receipts and SQL rows share one processing pipeline."
            />
            <DataCard
              loading={triggers.isLoading}
              error={triggers.error}
              empty={!triggers.data?.length}
              emptyText="No source triggers received."
            >
              <table>
                <thead>
                  <tr>
                    <th>Trigger</th>
                    <th>Connector</th>
                    <th>Status</th>
                    <th>Case</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {triggers.data?.map((t) => (
                    <tr key={t.id} onClick={() => setSelectedTrigger(t)}>
                      <td>
                        <button className="case-link">
                          <strong>{t.triggerType}</strong>
                          <span>{t.sourceRecordId || t.id}</span>
                        </button>
                      </td>
                      <td>{t.connectorType}</td>
                      <td>
                        <Status value={t.status} />
                      </td>
                      <td>{t.caseId?.slice(0, 8) || "—"}</td>
                      <td>{new Date(t.receivedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataCard>
          </>
        )}
        {tab === "runs" && (
          <>
            <Heading
              eyebrow="Read-only polling"
              title="SQL ingestion runs"
              subtitle="Durable checkpoints advance only after complete trigger capture."
            />
            <DataCard
              loading={runs.isLoading}
              error={runs.error}
              empty={!runs.data?.length}
              emptyText="No SQL polling runs."
            >
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Status</th>
                    <th>Rows</th>
                    <th>Checkpoint</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data?.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.startedAt).toLocaleString()}</td>
                      <td>
                        <Status value={r.status} />
                      </td>
                      <td>{r.rowsCaptured}</td>
                      <td>
                        {r.checkpointAfter
                          ? `${r.checkpointAfter.watermark} / ${r.checkpointAfter.tieBreaker}`
                          : "—"}
                      </td>
                      <td>{r.errorCode || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataCard>
          </>
        )}
      </main>
      {createSource && (
        <SourceForm
          onClose={() => setCreateSource(false)}
          onSaved={() => {
            setCreateSource(false);
            void client.invalidateQueries({
              queryKey: ["integration-sources-v2"],
            });
          }}
        />
      )}
      {selectedSource && (
        <SourcePanel
          source={selectedSource}
          onClose={() => setSelectedSource(null)}
        />
      )}
      {selectedTrigger && (
        <TriggerPanel
          trigger={selectedTrigger}
          onClose={() => setSelectedTrigger(null)}
          onChanged={() => {
            setSelectedTrigger(null);
            void client.invalidateQueries({
              queryKey: ["integration-triggers"],
            });
          }}
        />
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Landmark size={22} />
      </span>
      <div>
        <div className="brand-name">CDEP</div>
        <div className="brand-caption">Decision Evidence</div>
      </div>
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {action}
    </section>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${["ACTIVE", "READY", "PUBLISHED", "SUCCEEDED"].includes(value) ? "status-green" : ""}`}
    >
      {value}
    </span>
  );
}
function DataCard({
  loading,
  error,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  error: any;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card work-queue">
      {loading ? (
        <div className="empty-state">Loading controlled records…</div>
      ) : error ? (
        <div className="api-problem">{error.message}</div>
      ) : empty ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <div className="table-wrap">{children}</div>
      )}
    </section>
  );
}

function SourceForm({
  onClose,
  onSaved,
}: {
  onClose(): void;
  onSaved(): void;
}) {
  const auth = useAuth(),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal
      title="Create source system"
      eyebrow="Governed source catalog"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(auth, "/api/v1/integration/sources", {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify({ code, name, description }),
            });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="wide-field">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        {error && <div className="api-problem">{error}</div>}
        <Actions
          onClose={onClose}
          label="Create source"
          disabled={!code || !name}
        />
      </form>
    </Modal>
  );
}

function SourcePanel({ source, onClose }: { source: Source; onClose(): void }) {
  const auth = useAuth(),
    client = useQueryClient(),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<Connector | null>(null),
    [message, setMessage] = useState("");
  const connectors = useQuery({
    queryKey: ["integration-connectors", source.id],
    queryFn: () =>
      api<Connector[]>(
        auth,
        `/api/v1/integration/sources/${source.id}/connectors`,
      ),
  });
  async function activateSource() {
    try {
      await api(auth, `/api/v1/integration/sources/${source.id}/activate`, {
        method: "POST",
        headers: jsonHeaders,
        body: "{}",
      });
      setMessage("Source activated.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <Modal
      title={source.name}
      eyebrow={`${source.code} · ${source.status}`}
      onClose={onClose}
      wide
    >
      <div className="detail-section modal-actions">
        <PermissionGate permission="integration:source:manage">
          <button
            className="secondary-button"
            onClick={() => void activateSource()}
          >
            Activate source
          </button>
          <button className="primary-button" onClick={() => setCreate(true)}>
            <Plus size={16} />
            Add connector
          </button>
        </PermissionGate>
      </div>
      <div className="detail-section">
        <h3>Connectors</h3>
        {connectors.isLoading ? (
          <p>Loading…</p>
        ) : !connectors.data?.length ? (
          <p className="muted-cell">No connectors configured.</p>
        ) : (
          connectors.data.map((c) => (
            <button
              className="control-row connector-row"
              key={c.id}
              onClick={() => setSelected(c)}
            >
              <span>
                <strong>{c.name}</strong>
                <small>
                  {c.type} · {c.triggerType}
                </small>
              </span>
              <Status value={c.status} />
            </button>
          ))
        )}
      </div>
      {message && <div className="api-problem">{message}</div>}
      {create && (
        <ConnectorForm
          source={source}
          onClose={() => setCreate(false)}
          onSaved={() => {
            setCreate(false);
            void client.invalidateQueries({
              queryKey: ["integration-connectors", source.id],
            });
          }}
        />
      )}
      {selected && (
        <ConnectorPanel
          connector={selected}
          source={source}
          onClose={() => setSelected(null)}
        />
      )}
    </Modal>
  );
}

function ConnectorForm({
  source,
  onClose,
  onSaved,
}: {
  source: Source;
  onClose(): void;
  onSaved(): void;
}) {
  const auth = useAuth(),
    [type, setType] = useState<"WEBHOOK" | "SQL_POLL">("WEBHOOK"),
    [name, setName] = useState(""),
    [triggerType, setTrigger] = useState("source.application.updated"),
    [error, setError] = useState("");
  const [sql, setSql] = useState({
    host: "integration-demo-postgres",
    port: 5432,
    database: "cdep_source_demo",
    sslMode: "DISABLE",
    schema: "public",
    tableOrView: "source_applications",
    selectedColumns:
      "application_reference,customer_reference,status,requested_amount",
    watermarkColumn: "updated_at",
    watermarkType: "TIMESTAMP",
    tieBreakerColumn: "id",
    tieBreakerType: "UUID",
    sourceRecordIdColumn: "id",
    occurredAtColumn: "updated_at",
    pollIntervalSeconds: 30,
    batchSize: 2,
    statementTimeoutMs: 5000,
    initialLookbackMinutes: 10080,
  });
  async function save() {
    try {
      const configuration =
        type === "WEBHOOK"
          ? { rateLimitPerMinute: 60 }
          : {
              ...sql,
              selectedColumns: sql.selectedColumns
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            };
      await api(auth, `/api/v1/integration/sources/${source.id}/connectors`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name, type, triggerType, configuration }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={`Add ${type === "WEBHOOK" ? "webhook" : "SQL polling"} connector`}
      eyebrow="Connector configuration"
      onClose={onClose}
      wide
    >
      <div className="form-grid">
        <label>
          Connector type
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option>WEBHOOK</option>
            <option>SQL_POLL</option>
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Trigger type
          <input
            value={triggerType}
            onChange={(e) => setTrigger(e.target.value)}
          />
        </label>
        {type === "SQL_POLL" &&
          Object.entries(sql).map(([key, value]) => (
            <label key={key}>
              {label(key)}
              <input
                value={value}
                type={typeof value === "number" ? "number" : "text"}
                onChange={(e) =>
                  setSql({
                    ...sql,
                    [key]:
                      typeof value === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            </label>
          ))}
      </div>
      {error && <div className="api-problem">{error}</div>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={!name || !triggerType}
          onClick={() => void save()}
        >
          Create connector
        </button>
      </div>
    </Modal>
  );
}

function ConnectorPanel({
  connector,
  source,
  onClose,
}: {
  connector: Connector;
  source: Source;
  onClose(): void;
}) {
  const auth = useAuth(),
    client = useQueryClient(),
    [secret, setSecret] = useState(""),
    [username, setUsername] = useState("demo_reader"),
    [message, setMessage] = useState(""),
    [sample, setSample] = useState('{"applicationReference":"APP-1001"}'),
    [target, setTarget] = useState("businessReference"),
    [path, setPath] = useState("$.applicationReference"),
    [required, setRequired] = useState(false),
    [ruleType, setRuleType] = useState("BUSINESS_REFERENCE_EQUALS");
  const rules = useQuery({
    queryKey: ["extraction-rules", connector.id],
    queryFn: () =>
      api<any[]>(
        auth,
        `/api/v1/integration/connectors/${connector.id}/extraction-rules`,
      ),
  });
  async function call(
    pathname: string,
    init: RequestInit = { method: "POST", headers: jsonHeaders, body: "{}" },
  ) {
    try {
      const result = await api<any>(auth, pathname, init);
      setMessage(JSON.stringify(result));
      return result;
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function saveCredential() {
    const value =
      connector.type === "SQL_POLL"
        ? JSON.stringify({ username, password: secret })
        : secret;
    await call(`/api/v1/integration/connectors/${connector.id}/credentials`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
    });
    setSecret("");
  }
  return (
    <Modal
      title={connector.name}
      eyebrow={`${connector.type} · ${connector.status}`}
      onClose={onClose}
      wide
    >
      <div className="detail-section">
        <h3>Connection and operation</h3>
        {connector.type === "WEBHOOK" && (
          <div className="modal-note">
            POST {location.origin}/api/v1/integration/hooks/
            {connector.connectorKey}
          </div>
        )}
        <div className="inline-form">
          {connector.type === "SQL_POLL" && (
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Read-only SQL username"
            />
          )}
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              connector.type === "WEBHOOK"
                ? "Webhook API key (16+ characters)"
                : "Read-only SQL password"
            }
          />
          <button
            className="secondary-button"
            disabled={secret.length < 16 || !username}
            onClick={() => void saveCredential()}
          >
            Set / rotate credential
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              void call(`/api/v1/integration/connectors/${connector.id}/test`)
            }
          >
            Test connection
          </button>
        </div>
        <div className="modal-actions">
          <button
            className="primary-button"
            onClick={async () => {
              if (source.status !== "ACTIVE")
                await call(`/api/v1/integration/sources/${source.id}/activate`);
              await call(
                `/api/v1/integration/connectors/${connector.id}/activate`,
              );
              void client.invalidateQueries({
                queryKey: ["integration-connectors", source.id],
              });
            }}
          >
            Activate
          </button>
          {connector.type === "SQL_POLL" && (
            <PermissionGate permission="integration:connector:run">
              <button
                className="primary-button"
                onClick={() =>
                  void call(
                    `/api/v1/integration/connectors/${connector.id}/run`,
                    {
                      method: "POST",
                      headers: {
                        ...jsonHeaders,
                        "idempotency-key": crypto.randomUUID(),
                      },
                      body: "{}",
                    },
                  )
                }
              >
                Run now
              </button>
            </PermissionGate>
          )}
        </div>
      </div>
      <div className="detail-section">
        <h3>Optional field extraction</h3>
        {rules.data?.map((r) => (
          <div className="control-row" key={r.id}>
            <span>{r.targetField}</span>
            <strong>{r.sourcePath}</strong>
          </div>
        ))}
        <div className="form-grid">
          <label>
            Target
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {[
                "businessReference",
                "externalCaseReference",
                "subjectType",
                "subjectId",
                "occurredAt",
                "sourceRecordId",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Safe JSONPath
            <input value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />{" "}
            Required
          </label>
          <label className="wide-field">
            Sample JSON
            <textarea
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            className="secondary-button"
            onClick={async () => {
              await call(
                `/api/v1/integration/connectors/${connector.id}/extraction-rules`,
                {
                  method: "PUT",
                  headers: jsonHeaders,
                  body: JSON.stringify({
                    rules: [
                      {
                        targetField: target,
                        sourcePath: path,
                        required,
                        transform: "TRIM",
                      },
                    ],
                  }),
                },
              );
              void rules.refetch();
            }}
          >
            Save rules
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              void call(
                `/api/v1/integration/connectors/${connector.id}/test-extraction`,
                {
                  method: "POST",
                  headers: jsonHeaders,
                  body: JSON.stringify({ sample: JSON.parse(sample) }),
                },
              )
            }
          >
            Test extraction
          </button>
        </div>
      </div>
      <div className="detail-section">
        <h3>Case correlation</h3>
        <div className="inline-form">
          <select
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value)}
          >
            <option>BUSINESS_REFERENCE_EQUALS</option>
            <option>EXTERNAL_REFERENCE_EQUALS</option>
          </select>
          <button
            className="secondary-button"
            onClick={() =>
              void call(
                `/api/v1/integration/connectors/${connector.id}/correlation-rules`,
                {
                  method: "PUT",
                  headers: jsonHeaders,
                  body: JSON.stringify({
                    ruleType,
                    referenceType:
                      ruleType === "EXTERNAL_REFERENCE_EQUALS"
                        ? "APPLICATION"
                        : undefined,
                  }),
                },
              )
            }
          >
            Save correlation rule
          </button>
        </div>
      </div>
      {message && <div className="api-problem operation-result">{message}</div>}
    </Modal>
  );
}

function TriggerPanel({
  trigger,
  onClose,
  onChanged,
}: {
  trigger: Trigger;
  onClose(): void;
  onChanged(): void;
}) {
  const auth = useAuth(),
    [caseId, setCaseId] = useState(""),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState("");
  async function action(path: string, body: any) {
    try {
      await api(auth, path, {
        method: "POST",
        headers: { ...jsonHeaders, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <Modal
      title={trigger.triggerType}
      eyebrow={`${trigger.connectorType} · ${trigger.status}`}
      onClose={onClose}
    >
      <div className="detail-section">
        <div className="control-row">
          <span>Receipt</span>
          <strong>{trigger.id}</strong>
        </div>
        <div className="control-row">
          <span>Source record</span>
          <strong>{trigger.sourceRecordId || "Generated by CDEP"}</strong>
        </div>
      </div>
      {["UNMATCHED", "AMBIGUOUS_CORRELATION"].includes(trigger.status) && (
        <PermissionGate permission="integration:correlation:resolve">
          <div className="detail-section">
            <h3>Manual case resolution</h3>
            <input
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              placeholder="Decision Case UUID"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Resolution reason"
            />
            <button
              className="primary-button"
              onClick={() =>
                void action(
                  `/api/v1/integration/triggers/${trigger.id}/resolve-case`,
                  { caseId, reason },
                )
              }
            >
              Resolve and resume
            </button>
          </div>
        </PermissionGate>
      )}
      <PermissionGate permission="integration:replay">
        <div className="detail-section">
          <h3>Replay</h3>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Replay reason"
          />
          <button
            className="secondary-button"
            onClick={() =>
              void action(`/api/v1/integration/triggers/${trigger.id}/replay`, {
                reason,
              })
            }
          >
            Confirm replay
          </button>
        </div>
      </PermissionGate>
      {message && <div className="api-problem">{message}</div>}
    </Modal>
  );
}

function Modal({
  title,
  eyebrow,
  onClose,
  wide,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose(): void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} />
      <section className={`modal-card ${wide ? "case-detail-card" : ""}`}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Actions({
  onClose,
  label,
  disabled,
}: {
  onClose(): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="modal-actions">
      <button type="button" className="secondary-button" onClick={onClose}>
        Cancel
      </button>
      <button className="primary-button" disabled={disabled}>
        {label}
      </button>
    </div>
  );
}
function label(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase());
}
async function api<T>(
  auth: ReturnType<typeof useAuth>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await auth.request(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      body.detail ?? body.message ?? `Request failed (${response.status})`,
    );
  return body;
}
