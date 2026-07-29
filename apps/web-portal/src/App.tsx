import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  BriefcaseBusiness,
  BrainCircuit,
  Cable,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  FileCheck2,
  Fingerprint,
  History,
  Gavel,
<<<<<<< HEAD
=======
  Landmark,
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
  LogOut,
  Menu,
  PencilLine,
  Plus,
  Search,
  ShieldCheck,
  UserRoundCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { PermissionGate, useAuth } from "./auth";
import { RevisedIntegrationWorkspace } from "./Integrations";
import { EvidencePanel } from "./Evidence";
import { WorkflowOperations, WorkflowPanel } from "./Workflow";
import { AiAssessmentPanel, AiGovernanceWorkspace } from "./AiAssessment";
import {
  CaseLedgerSummary,
  CaseLedgerTab,
  LedgerActivity,
  useCaseLedger,
} from "./CaseLedger";
import {
  casePath,
  navigate,
  parsePortalRoute,
  type CaseSection,
} from "./routing";
import { SelectField, StatusBadge } from "./ui";
<<<<<<< HEAD
import { ApplicationShell } from "./ApplicationShell";
import { AuditWorkspace } from "./Audit";
import { LandingPage } from "./LandingPage";
=======
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d

type Party = { id: string; partyType: string; displayName: string };
type Assignment = { id: string; userId: string; role: string };
type Timeline = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  changedAt: string;
};
type Case = {
  id: string;
  caseNumber: string;
  title: string;
  caseType: string;
  status: string;
  priority: string;
  requestedAmountMinor: number | null;
  currency: string | null;
  version: number;
  updatedAt: string;
  parties?: Party[];
  assignments?: Assignment[];
};
type CaseList = {
  items: Case[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
<<<<<<< HEAD
=======
type Login = { email: string; password: string };
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
type NewCase = {
  title: string;
  caseType: string;
  priority: string;
  externalReference: string;
  requestedAmount: string;
  currency: string;
};

export function caseLifecycleStage(status: string) {
  if (["DECIDED", "CLOSED"].includes(status)) return 4;
  if (["UNDER_REVIEW", "DECISION_PENDING"].includes(status)) return 3;
  if (["OPEN", "EVIDENCE_COLLECTION"].includes(status)) return 2;
  return 1;
}

function CaseLifecycleStepper({ status }: { status: string }) {
  const current = caseLifecycleStage(status);
  const steps = [
    ["Record", "Case details"],
    ["Evidence", "Collection & controls"],
    ["Review", "Assessment & workflow"],
    ["Decision", "Proof & closure"],
  ] as const;
  return (
    <nav className="case-lifecycle" aria-label="Case lifecycle">
      <ol>
        {steps.map(([label, description], index) => {
          const step = index + 1;
          const complete = step < current;
          const active = step === current;
          return (
            <li
              key={label}
              className={
                complete
                  ? "case-lifecycle-complete"
                  : active
                    ? "case-lifecycle-active"
                    : ""
              }
              aria-current={active ? "step" : undefined}
            >
              <span className="case-lifecycle-marker">{step}</span>
              <span className="case-lifecycle-copy">
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function caseStagePresentation(status: string) {
  if (["DECIDED", "CLOSED"].includes(status))
    return { stage: "Decide", description: "Final decision" };
  if (status === "DECISION_PENDING")
    return { stage: "Recommend", description: "Decision preparation" };
  if (status === "UNDER_REVIEW")
    return { stage: "Review", description: "Risk & readiness" };
  if (status === "CANCELLED")
    return { stage: "Closed", description: "Cancelled case" };
  return { stage: "Validate", description: "Evidence & controls" };
}

function CaseRegisterMetric({
  icon: Icon,
  label,
  value,
  description,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  description: string;
  tone: "green" | "blue" | "amber" | "emerald";
}) {
  return (
    <div className="case-register-metric">
      <span className={`case-register-metric-icon metric-${tone}`}>
        <Icon size={22} aria-hidden="true" />
      </span>
      <span className="case-register-metric-value">
        <strong>{value ?? "—"}</strong>
        <small>{label}</small>
      </span>
      <span className="case-register-metric-description">{description}</span>
    </div>
  );
}

export function App() {
  const auth = useAuth();
  if (auth.checking)
    return (
      <div className="auth-screen">
        <div className="login-card">
          <p>Restoring secure session…</p>
        </div>
      </div>
    );
<<<<<<< HEAD
  if (!auth.identity) return <LandingPage />;
  return <CaseWorkspace />;
}

=======
  if (!auth.identity) return <LoginScreen />;
  return <CaseWorkspace />;
}

function LoginScreen() {
  const auth = useAuth();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Login>();
  const [error, setError] = useState("");
  return (
    <main className="auth-screen">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark">
            <Landmark size={24} />
          </span>
          <div>
            <h1>CDEP</h1>
            <p>Decision Evidence</p>
          </div>
        </div>
        <h2>Sign in to your workspace</h2>
        <p>Use your controlled CDEP identity.</p>
        <form
          onSubmit={handleSubmit(async (data) => {
            setError("");
            try {
              await auth.login(data.email, data.password);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Login failed.");
            }
          })}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              {...register("email", { required: true })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              {...register("password", { required: true, minLength: 12 })}
            />
          </label>
          {error && <div className="api-problem">{error}</div>}
          <button className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
function CaseWorkspace() {
  const auth = useAuth();
  const client = useQueryClient();
  const [route, setRoute] = useState(() => parsePortalRoute(location));
  const [search, setSearch] = useState(route.search);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Case | null>(null);
  const [routeError, setRouteError] = useState("");
  const [routeLoading, setRouteLoading] = useState(Boolean(route.caseId));
<<<<<<< HEAD
=======
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
  useEffect(() => {
    if (location.pathname === "/" || location.hash.startsWith("#case=")) {
      const initial = parsePortalRoute(location);
      navigate(
        initial.caseId
          ? casePath(initial.caseId, initial.section)
          : `/cases${location.search}`,
        true,
      );
    }
    const sync = () => {
      const next = parsePortalRoute(location);
      setRoute(next);
      setSearch(next.search);
<<<<<<< HEAD
=======
      setMobileNavOpen(false);
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
    };
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!route.caseId) {
      setSelected(null);
      setRouteError("");
      setRouteLoading(false);
      return () => controller.abort();
    }
    if (selected?.id === route.caseId) {
      setRouteLoading(false);
      return () => controller.abort();
    }
    setSelected(null);
    setRouteError("");
    setRouteLoading(true);
    void auth
      .request(`/api/v1/cases/${route.caseId}`, {
        signal: controller.signal,
      })
      .then(async (response) => {
        if (response.status === 403)
          throw new Error(
            "Your role is not permitted to read this case. No case data was loaded.",
          );
        if (response.status === 404)
          throw new Error(
            "The requested case is unavailable or outside your organization.",
          );
        if (!response.ok) throw await problem(response);
        const item = (await response.json()) as Case;
        client.setQueryData(["case", item.id], item);
        setSelected(item);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setRouteError(
          cause instanceof Error
            ? cause.message
            : "The requested case could not be opened.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false);
      });
    return () => controller.abort();
  }, [auth, client, route.caseId, selected?.id]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (route.workspace !== "cases" || route.caseId) return;
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (route.status) params.set("status", route.status);
      if (route.priority) params.set("priority", route.priority);
      const nextPage = search.trim() === route.search.trim() ? route.page : 1;
      if (nextPage > 1) params.set("page", String(nextPage));
      const next = `/cases${params.size ? `?${params}` : ""}`;
      if (`${location.pathname}${location.search}` !== next) {
        history.replaceState(null, "", next);
        setRoute(parsePortalRoute(location));
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [
    route.caseId,
    route.priority,
    route.page,
    route.search,
    route.status,
    route.workspace,
    search,
  ]);
<<<<<<< HEAD
=======
  useEffect(() => {
    if (!mobileNavOpen || !sidebar.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = sidebar.current;
    root.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
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
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      (previous ?? menuButton.current)?.focus();
    };
  }, [mobileNavOpen]);
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
  const query = useQuery({
    queryKey: ["cases", search, route.status, route.priority, route.page],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        page: String(route.page),
        pageSize: "10",
      });
      if (search) params.set("search", search);
      if (route.status) params.set("status", route.status);
      if (route.priority) params.set("priority", route.priority);
      const r = await auth.request(`/api/v1/cases?${params}`, { signal });
      if (!r.ok) throw await problem(r);
      return r.json() as Promise<CaseList>;
    },
    enabled: route.workspace === "cases" && !route.caseId,
  });
  const caseMetrics = useQuery({
    queryKey: ["case-register-metrics"],
    queryFn: async ({ signal }) => {
      const definitions = [
        ["total", ""],
        ["underReview", "UNDER_REVIEW"],
        ["awaitingAction", "DECISION_PENDING"],
        ["decided", "DECIDED"],
      ] as const;
      const totals = await Promise.all(
        definitions.map(async ([key, status]) => {
          const params = new URLSearchParams({ page: "1", pageSize: "1" });
          if (status) params.set("status", status);
          const response = await auth.request(`/api/v1/cases?${params}`, {
            signal,
          });
          if (!response.ok) throw await problem(response);
          const data = (await response.json()) as CaseList;
          return [key, data.total] as const;
        }),
      );
      return Object.fromEntries(totals) as Record<
        (typeof definitions)[number][0],
        number
      >;
    },
    enabled: route.workspace === "cases" && !route.caseId,
  });
  function openCase(item: Case, section: CaseSection = "overview") {
    setSelected(item);
    navigate(casePath(item.id, section));
  }
  function updateCaseFilters(
    updates: Partial<Pick<typeof route, "status" | "priority" | "page">>,
  ) {
    const next = { ...route, ...updates };
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (next.status) params.set("status", next.status);
    if (next.priority) params.set("priority", next.priority);
    if (next.page > 1) params.set("page", String(next.page));
    navigate(`/cases${params.size ? `?${params}` : ""}`);
  }
  if (route.workspace === "integrations")
<<<<<<< HEAD
    return <RevisedIntegrationWorkspace />;
  if (route.workspace === "workflow") return <WorkflowOperations />;
  if (route.workspace === "audit")
    return (
      <ApplicationShell activeWorkspace="audit">
        <AuditWorkspace />
      </ApplicationShell>
    );
  return (
    <ApplicationShell
      activeWorkspace={
        route.workspace === "ai-governance" ? "ai-governance" : "cases"
      }
    >
      {route.workspace === "ai-governance" ? (
        <AiGovernanceWorkspace />
      ) : routeLoading ? (
        <div className="card empty-state" role="status">
          Loading case…
        </div>
      ) : routeError ? (
        <section className="card safe-route-state" role="alert">
          <h1>Case unavailable</h1>
          <p>{routeError}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate("/cases")}
          >
            Back to case register
          </button>
        </section>
      ) : selected ? (
        <CaseDetailPage
          item={selected}
          section={route.section}
          onBack={() =>
            navigate(
              `/cases${search ? `?search=${encodeURIComponent(search)}` : ""}`,
            )
          }
        />
      ) : (
        <>
          <section className="page-heading case-register-page-heading">
            <div>
              <h1>Decision cases</h1>
              <p className="page-subtitle">
                Create a case, assign the right people and track it through to
                the final decision.
              </p>
            </div>
            <PermissionGate permission="case:create">
              <button
                className="primary-button"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={18} />
                New decision case
              </button>
            </PermissionGate>
          </section>
          <section
            className="card case-register-metrics"
            aria-label="Decision case totals"
            aria-busy={caseMetrics.isLoading}
          >
            <CaseRegisterMetric
              icon={BriefcaseBusiness}
              label="Total"
              value={caseMetrics.data?.total ?? null}
              description="All decision cases"
              tone="green"
            />
            <CaseRegisterMetric
              icon={Eye}
              label="Under review"
              value={caseMetrics.data?.underReview ?? null}
              description="Risk and readiness"
              tone="blue"
            />
            <CaseRegisterMetric
              icon={CircleAlert}
              label="Awaiting action"
              value={caseMetrics.data?.awaitingAction ?? null}
              description="Decision pending"
              tone="amber"
            />
            <CaseRegisterMetric
              icon={ShieldCheck}
              label="Decided"
              value={caseMetrics.data?.decided ?? null}
              description="Finalised decisions"
              tone="emerald"
            />
          </section>
          {caseMetrics.isError && (
            <div className="api-warning" role="status">
              Summary totals are temporarily unavailable. The case register
              remains current and usable.
            </div>
          )}
          <section className="card work-queue">
            <div className="case-register-controls">
              <label className="case-register-search">
                <span className="sr-only">Search decision cases</span>
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search cases"
                />
              </label>
              <SelectField
                label="Status"
                hideLabel
                value={route.status}
                onChange={(event) =>
                  updateCaseFilters({
                    status: event.target.value,
                    page: 1,
                  })
                }
              >
                <option value="">All statuses</option>
                <option>DRAFT</option>
                <option>OPEN</option>
                <option>EVIDENCE_COLLECTION</option>
                <option>UNDER_REVIEW</option>
                <option>DECISION_PENDING</option>
                <option>DECIDED</option>
                <option>CLOSED</option>
                <option>CANCELLED</option>
              </SelectField>
              <SelectField
                label="Priority"
                hideLabel
                value={route.priority}
                onChange={(event) =>
                  updateCaseFilters({
                    priority: event.target.value,
                    page: 1,
                  })
                }
              >
                <option value="">All priorities</option>
                <option>LOW</option>
                <option>NORMAL</option>
                <option>HIGH</option>
                <option>URGENT</option>
              </SelectField>
              {(route.status || route.priority || search) && (
                <button
                  type="button"
                  className="secondary-button case-clear-filters"
                  onClick={() => {
                    setSearch("");
                    navigate("/cases");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
            {query.isLoading ? (
              <div className="empty-state">Loading decision cases…</div>
            ) : query.isError ? (
              <div className="api-problem">{query.error.message}</div>
            ) : query.data?.items.length === 0 ? (
              <div className="empty-state">No decision cases found.</div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="case-register-table">
                    <thead>
                      <tr>
                        <th scope="col">Case</th>
                        <th scope="col">Type</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Stage</th>
                        <th scope="col">Status</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Updated</th>
                        <th scope="col">
                          <span className="sr-only">Open case</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data?.items.map((item) => {
                        const stage = caseStagePresentation(item.status);
                        return (
                          <tr key={item.id}>
                            <td>
                              <button
                                className="case-link"
                                onClick={() => openCase(item)}
                              >
                                <strong>{item.title}</strong>
                                <span>{item.caseNumber}</span>
                              </button>
                            </td>
                            <td className="case-type-cell">
                              {item.caseType.replaceAll("_", " ")}
                            </td>
                            <td>
                              <StatusBadge value={item.priority} />
                            </td>
                            <td>
                              <span className="case-stage">
                                <strong>{stage.stage}</strong>
                                <small>{stage.description}</small>
                              </span>
                            </td>
                            <td>
                              <StatusBadge value={item.status} />
                            </td>
                            <td className="case-amount-cell">
                              {item.requestedAmountMinor == null
                                ? "Not recorded"
                                : `${item.currency} ${(item.requestedAmountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                            </td>
                            <td className="case-updated-cell">
                              {new Date(item.updatedAt).toLocaleString(
                                undefined,
                                {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                },
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="row-action"
                                onClick={() => openCase(item)}
                                aria-label={`Open ${item.caseNumber}`}
                              >
                                <ChevronRight size={17} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <span className="pagination-summary">
                    {query.data!.total} records · {query.data!.pageSize} per
                    page
                  </span>
                  <div
                    className="pagination-controls"
                    aria-label="Case register pages"
                  >
                    <button
                      type="button"
                      className="icon-button"
                      disabled={query.data!.page <= 1}
                      onClick={() =>
                        updateCaseFilters({ page: query.data!.page - 1 })
                      }
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={17} />
                    </button>
                    {[
                      query.data!.page - 1,
                      query.data!.page,
                      query.data!.page + 1,
                    ]
                      .filter(
                        (page) => page >= 1 && page <= query.data!.totalPages,
                      )
                      .map((page) => (
                        <button
                          type="button"
                          key={page}
                          className={`pagination-page ${page === query.data!.page ? "pagination-page-active" : ""}`}
                          aria-current={
                            page === query.data!.page ? "page" : undefined
                          }
                          onClick={() => updateCaseFilters({ page })}
                        >
                          {page}
                        </button>
                      ))}
                    <button
                      type="button"
                      className="icon-button"
                      disabled={query.data!.page >= query.data!.totalPages}
                      onClick={() =>
                        updateCaseFilters({ page: query.data!.page + 1 })
                      }
                      aria-label="Next page"
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}
=======
    return <RevisedIntegrationWorkspace onCases={() => navigate("/cases")} />;
  if (route.workspace === "workflow")
    return <WorkflowOperations onCases={() => navigate("/cases")} />;
  return (
    <div className="app-shell">
      {mobileNavOpen && (
        <button
          type="button"
          className="mobile-overlay"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        ref={sidebar}
        className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="brand">
          <span className="brand-mark">
            <Landmark size={22} />
          </span>
          <div>
            <div className="brand-name">CDEP</div>
            <div className="brand-caption">Decision Evidence</div>
          </div>
          <button
            type="button"
            className="icon-button mobile-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <p className="nav-label">Workspace</p>
        <button
          type="button"
          className={`nav-item ${route.workspace === "cases" ? "nav-item-active" : ""}`}
          aria-current={route.workspace === "cases" ? "page" : undefined}
          onClick={() => navigate("/cases")}
        >
          <BriefcaseBusiness size={18} />
          <span>Decision cases</span>
        </button>
        <PermissionGate permission="integration:source:read">
          <button
            type="button"
            className="nav-item"
            onClick={() => navigate("/integrations")}
          >
            <Cable size={18} />
            <span>Integrations</span>
          </button>
        </PermissionGate>
        <PermissionGate permission="workflow:task:read">
          <button
            type="button"
            className="nav-item"
            onClick={() => navigate("/workflow")}
          >
            <Gavel size={18} />
            <span>Workflow queue</span>
          </button>
        </PermissionGate>
        <PermissionGate permission="ai-governance:read">
          <button
            type="button"
            className={`nav-item ${route.workspace === "ai-governance" ? "nav-item-active" : ""}`}
            aria-current={
              route.workspace === "ai-governance" ? "page" : undefined
            }
            onClick={() => navigate("/ai-governance")}
          >
            <BrainCircuit size={18} />
            <span>AI governance</span>
          </button>
        </PermissionGate>
        <div className="sidebar-footer">
          <div className="environment-row">
            <span className="environment-dot" />
            Controlled environment
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar glass-panel">
          <button
            ref={menuButton}
            type="button"
            className="icon-button menu-button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
          >
            <Menu size={19} />
          </button>
          <strong className="cockpit-title">Operations cockpit</strong>
          <div className="topbar-actions">
            <span className="profile-copy">
              <strong>{auth.identity?.displayName}</strong>
              <small>{auth.identity?.email}</small>
            </span>
            <button
              className="icon-button"
              onClick={() => void auth.logout()}
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {route.workspace === "ai-governance" ? (
          <AiGovernanceWorkspace />
        ) : routeLoading ? (
          <div className="card empty-state" role="status">
            Loading case…
          </div>
        ) : routeError ? (
          <section className="card safe-route-state" role="alert">
            <h1>Case unavailable</h1>
            <p>{routeError}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate("/cases")}
            >
              Back to case register
            </button>
          </section>
        ) : selected ? (
          <CaseDetailPage
            item={selected}
            section={route.section}
            onBack={() =>
              navigate(
                `/cases${search ? `?search=${encodeURIComponent(search)}` : ""}`,
              )
            }
          />
        ) : (
          <>
            <section className="page-heading case-register-page-heading">
              <div>
                <h1>Decision cases</h1>
                <p className="page-subtitle">
                  Create and manage tenant-scoped credit decision records.
                </p>
              </div>
              <PermissionGate permission="case:create">
                <button
                  className="primary-button"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={18} />
                  New decision case
                </button>
              </PermissionGate>
            </section>
            <section
              className="card case-register-metrics"
              aria-label="Decision case totals"
              aria-busy={caseMetrics.isLoading}
            >
              <CaseRegisterMetric
                icon={BriefcaseBusiness}
                label="Total"
                value={caseMetrics.data?.total ?? null}
                description="All decision cases"
                tone="green"
              />
              <CaseRegisterMetric
                icon={Eye}
                label="Under review"
                value={caseMetrics.data?.underReview ?? null}
                description="Risk and readiness"
                tone="blue"
              />
              <CaseRegisterMetric
                icon={CircleAlert}
                label="Awaiting action"
                value={caseMetrics.data?.awaitingAction ?? null}
                description="Decision pending"
                tone="amber"
              />
              <CaseRegisterMetric
                icon={ShieldCheck}
                label="Decided"
                value={caseMetrics.data?.decided ?? null}
                description="Finalised decisions"
                tone="emerald"
              />
            </section>
            {caseMetrics.isError && (
              <div className="api-warning" role="status">
                Summary totals are temporarily unavailable. The case register
                remains current and usable.
              </div>
            )}
            <section className="card work-queue">
              <div className="case-register-controls">
                <label className="case-register-search">
                  <span className="sr-only">Search decision cases</span>
                  <Search size={18} aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search cases"
                  />
                </label>
                <SelectField
                  label="Status"
                  hideLabel
                  value={route.status}
                  onChange={(event) =>
                    updateCaseFilters({
                      status: event.target.value,
                      page: 1,
                    })
                  }
                >
                  <option value="">All statuses</option>
                  <option>DRAFT</option>
                  <option>OPEN</option>
                  <option>EVIDENCE_COLLECTION</option>
                  <option>UNDER_REVIEW</option>
                  <option>DECISION_PENDING</option>
                  <option>DECIDED</option>
                  <option>CLOSED</option>
                  <option>CANCELLED</option>
                </SelectField>
                <SelectField
                  label="Priority"
                  hideLabel
                  value={route.priority}
                  onChange={(event) =>
                    updateCaseFilters({
                      priority: event.target.value,
                      page: 1,
                    })
                  }
                >
                  <option value="">All priorities</option>
                  <option>LOW</option>
                  <option>NORMAL</option>
                  <option>HIGH</option>
                  <option>URGENT</option>
                </SelectField>
                {(route.status || route.priority || search) && (
                  <button
                    type="button"
                    className="secondary-button case-clear-filters"
                    onClick={() => {
                      setSearch("");
                      navigate("/cases");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
              {query.isLoading ? (
                <div className="empty-state">Loading decision cases…</div>
              ) : query.isError ? (
                <div className="api-problem">{query.error.message}</div>
              ) : query.data?.items.length === 0 ? (
                <div className="empty-state">No decision cases found.</div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="case-register-table">
                      <thead>
                        <tr>
                          <th scope="col">Case</th>
                          <th scope="col">Type</th>
                          <th scope="col">Priority</th>
                          <th scope="col">Stage</th>
                          <th scope="col">Status</th>
                          <th scope="col">Amount</th>
                          <th scope="col">Updated</th>
                          <th scope="col">
                            <span className="sr-only">Open case</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {query.data?.items.map((item) => {
                          const stage = caseStagePresentation(item.status);
                          return (
                            <tr key={item.id}>
                              <td>
                                <button
                                  className="case-link"
                                  onClick={() => openCase(item)}
                                >
                                  <strong>{item.title}</strong>
                                  <span>{item.caseNumber}</span>
                                </button>
                              </td>
                              <td className="case-type-cell">
                                {item.caseType.replaceAll("_", " ")}
                              </td>
                              <td>
                                <StatusBadge value={item.priority} />
                              </td>
                              <td>
                                <span className="case-stage">
                                  <strong>{stage.stage}</strong>
                                  <small>{stage.description}</small>
                                </span>
                              </td>
                              <td>
                                <StatusBadge value={item.status} />
                              </td>
                              <td className="case-amount-cell">
                                {item.requestedAmountMinor == null
                                  ? "Not recorded"
                                  : `${item.currency} ${(item.requestedAmountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                              </td>
                              <td className="case-updated-cell">
                                {new Date(item.updatedAt).toLocaleString(
                                  undefined,
                                  {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  },
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="row-action"
                                  onClick={() => openCase(item)}
                                  aria-label={`Open ${item.caseNumber}`}
                                >
                                  <ChevronRight size={17} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination">
                    <span className="pagination-summary">
                      {query.data!.total} records · {query.data!.pageSize} per
                      page
                    </span>
                    <div
                      className="pagination-controls"
                      aria-label="Case register pages"
                    >
                      <button
                        type="button"
                        className="icon-button"
                        disabled={query.data!.page <= 1}
                        onClick={() =>
                          updateCaseFilters({ page: query.data!.page - 1 })
                        }
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={17} />
                      </button>
                      {[
                        query.data!.page - 1,
                        query.data!.page,
                        query.data!.page + 1,
                      ]
                        .filter(
                          (page) => page >= 1 && page <= query.data!.totalPages,
                        )
                        .map((page) => (
                          <button
                            type="button"
                            key={page}
                            className={`pagination-page ${page === query.data!.page ? "pagination-page-active" : ""}`}
                            aria-current={
                              page === query.data!.page ? "page" : undefined
                            }
                            onClick={() => updateCaseFilters({ page })}
                          >
                            {page}
                          </button>
                        ))}
                      <button
                        type="button"
                        className="icon-button"
                        disabled={query.data!.page >= query.data!.totalPages}
                        onClick={() =>
                          updateCaseFilters({ page: query.data!.page + 1 })
                        }
                        aria-label="Next page"
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </main>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
      {createOpen && (
        <CreateCase
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void client.invalidateQueries({ queryKey: ["cases"] });
            void client.invalidateQueries({
              queryKey: ["case-register-metrics"],
            });
          }}
        />
      )}
<<<<<<< HEAD
    </ApplicationShell>
=======
    </div>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
  );
}

type SourceSystem = {
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
  sourceSystemId: string;
  name: string;
  type: string;
  status: string;
  version: number;
  lastSuccessAt?: string;
  lastErrorCode?: string;
};
type RawEvent = {
  id: string;
  sourceEventId: string;
  sourceEventType?: string;
  status: string;
  receivedAt: string;
  correlationId: string;
};
function IntegrationWorkspace({ onCases }: { onCases(): void }) {
  const auth = useAuth(),
    client = useQueryClient(),
    [selected, setSelected] = useState<SourceSystem | null>(null),
    [create, setCreate] = useState(false),
    [tab, setTab] = useState<"sources" | "events">("sources");
  const sources = useQuery({
    queryKey: ["integration-sources"],
    queryFn: async () => {
      const r = await auth.request("/api/v1/integration/source-systems");
      if (!r.ok) throw await problem(r);
      return r.json() as Promise<SourceSystem[]>;
    },
  });
  const events = useQuery({
    queryKey: ["integration-events"],
    queryFn: async () => {
      const r = await auth.request("/api/v1/integration/events?limit=100");
      if (!r.ok) throw await problem(r);
      return r.json() as Promise<RawEvent[]>;
    },
    enabled: tab === "events",
  });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
<<<<<<< HEAD
            <ShieldCheck size={22} />
          </span>
          <div>
            <div className="brand-name">Aegis</div>
            <div className="brand-caption">Decision Evidence Vault</div>
=======
            <Landmark size={22} />
          </span>
          <div>
            <div className="brand-name">CDEP</div>
            <div className="brand-caption">Decision Evidence</div>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </div>
        </div>
        <p className="nav-label">Workspace</p>
        <button className="nav-item" onClick={onCases}>
          <BriefcaseBusiness size={18} />
          <span>Decision cases</span>
        </button>
        <button
          className="nav-item nav-item-active"
          onClick={() => setTab("sources")}
        >
          <Cable size={18} />
          <span>Source systems</span>
        </button>
        <button
          className={`nav-item ${tab === "events" ? "nav-item-active" : ""}`}
          onClick={() => setTab("events")}
        >
          <Activity size={18} />
          <span>Event monitor</span>
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
          <div>
            <strong>Integration administration</strong>
          </div>
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
        {tab === "sources" ? (
          <>
            <section className="page-heading">
              <div>
<<<<<<< HEAD
                <p className="eyebrow">Source setup</p>
                <h1>Source systems</h1>
                <p className="page-subtitle">
                  Add the systems that send records to Aegis and manage their
                  connections.
=======
                <p className="eyebrow">Phase 2B · Source integration</p>
                <h1>Source systems</h1>
                <p className="page-subtitle">
                  Configure governed inbound adapters, credentials and
                  activation.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                </p>
              </div>
              <PermissionGate permission="integration:source:manage">
                <button
                  className="primary-button"
                  onClick={() => setCreate(true)}
                >
                  <Plus size={18} />
                  New source system
                </button>
              </PermissionGate>
            </section>
            <section className="card work-queue">
              <div className="card-header">
                <div>
                  <h2>Integration register</h2>
                  <p>{sources.data?.length ?? 0} configured sources</p>
                </div>
              </div>
              {sources.isLoading ? (
                <div className="empty-state">Loading source systems…</div>
              ) : sources.isError ? (
                <div className="api-problem">{sources.error.message}</div>
              ) : !sources.data?.length ? (
                <div className="empty-state">
                  No source systems configured. Create the first source to
                  begin.
                </div>
              ) : (
                <div className="table-wrap">
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
                      {sources.data.map((s) => (
                        <tr key={s.id} onClick={() => setSelected(s)}>
                          <td>
                            <button className="case-link">
                              <strong>{s.name}</strong>
                              <span>
                                {s.description || "External decision source"}
                              </span>
                            </button>
                          </td>
                          <td>{s.code}</td>
                          <td>
                            <span
                              className={`status ${s.status === "ACTIVE" ? "status-green" : ""}`}
                            >
                              {s.status}
                            </span>
                          </td>
                          <td>v{s.version}</td>
                          <td>{new Date(s.updatedAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="page-heading">
              <div>
<<<<<<< HEAD
                <p className="eyebrow">Source activity</p>
                <h1>Incoming records</h1>
                <p className="page-subtitle">
                  See what Aegis received, when it arrived and whether it was
                  matched to a case.
=======
                <p className="eyebrow">Operational visibility</p>
                <h1>Raw event monitor</h1>
                <p className="page-subtitle">
                  Immutable, tenant-scoped ingestion receipts with redacted
                  payload access.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                </p>
              </div>
            </section>
            <section className="card work-queue">
              <div className="card-header">
                <div>
                  <h2>Recent ingestion</h2>
                  <p>{events.data?.length ?? 0} receipts</p>
                </div>
              </div>
              {events.isLoading ? (
                <div className="empty-state">Loading events…</div>
              ) : events.isError ? (
                <div className="api-problem">{events.error.message}</div>
              ) : !events.data?.length ? (
                <div className="empty-state">
                  No source events received yet.
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Source event</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Received</th>
                        <th>Correlation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.data.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.sourceEventId}</strong>
                          </td>
                          <td>{e.sourceEventType || "—"}</td>
                          <td>
                            <span className="status status-green">
                              {e.status}
                            </span>
                          </td>
                          <td>{new Date(e.receivedAt).toLocaleString()}</td>
                          <td className="muted-cell">
                            {e.correlationId.slice(0, 8)}…
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      {create && (
        <CreateSource
          onClose={() => setCreate(false)}
          onCreated={() => {
            setCreate(false);
            void client.invalidateQueries({
              queryKey: ["integration-sources"],
            });
          }}
        />
      )}
      {selected && (
        <SourceDetail source={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
function CreateSource({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(): void;
}) {
  const auth = useAuth(),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} />
      <section className="modal-card">
        <div className="modal-header">
          <div>
<<<<<<< HEAD
            <p className="eyebrow">New source</p>
=======
            <p className="eyebrow">Governed configuration</p>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
            <h2>Create source system</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await auth.request("/api/v1/integration/source-systems", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code, name, description }),
            });
            if (!r.ok) return setError((await problem(r)).message);
            onCreated();
          }}
        >
          <div className="form-grid">
            <label>
              Source code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="LOS"
              />
            </label>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Loan origination system"
              />
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
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={!code || !name}>
              Create source
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function SourceDetail({
  source,
  onClose,
}: {
  source: SourceSystem;
  onClose(): void;
}) {
  const auth = useAuth(),
    client = useQueryClient(),
    [name, setName] = useState("Webhook inbound"),
    [secret, setSecret] = useState(""),
    [connector, setConnector] = useState<Connector | null>(null),
    [message, setMessage] = useState("");
  const connectors = useQuery({
    queryKey: ["connectors", source.id],
    queryFn: async () => {
      const r = await auth.request(
        `/api/v1/integration/source-systems/${source.id}/connectors`,
      );
      if (!r.ok) throw await problem(r);
      return r.json() as Promise<Connector[]>;
    },
  });
  async function call(path: string, init: RequestInit = {}) {
    const r = await auth.request(path, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMessage(data.message || `Request failed (${r.status})`);
      return null;
    }
    setMessage("Saved successfully.");
    return data;
  }
  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} />
      <section className="modal-card case-detail-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">
              {source.code} · {source.status}
            </p>
            <h2>{source.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="detail-section">
          <h3>Connectors</h3>
          {connectors.data?.map((c) => (
            <button
              className="control-row connector-row"
              key={c.id}
              onClick={() => setConnector(c)}
            >
              <span>
                <strong>{c.name}</strong>
                <small>{c.type}</small>
              </span>
              <span className="status">{c.status}</span>
            </button>
          ))}
          {!connectors.data?.length && (
            <p className="muted-cell">No connectors yet.</p>
          )}
          <PermissionGate permission="integration:connector:manage">
            <div className="inline-form">
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <select disabled>
                <option>WEBHOOK</option>
              </select>
              <button
                className="secondary-button"
                onClick={async () => {
                  const c = await call(
                    `/api/v1/integration/source-systems/${source.id}/connectors`,
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        name,
                        type: "WEBHOOK",
                        configuration: {
                          sourceEventIdHeader: "x-source-event-id",
                          sourceEventTypeHeader: "x-source-event-type",
                        },
                      }),
                    },
                  );
                  if (c) {
                    setConnector(c);
                    void client.invalidateQueries({
                      queryKey: ["connectors", source.id],
                    });
                  }
                }}
              >
                Add webhook
              </button>
            </div>
          </PermissionGate>
        </div>
        {connector && (
          <div className="detail-section">
            <h3>{connector.name} setup</h3>
            <p className="muted-cell">
              Credential values are encrypted and never returned by the API.
            </p>
            <div className="inline-form">
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Webhook signing secret (16+ chars)"
              />
              <button
                className="secondary-button"
                disabled={secret.length < 16}
                onClick={async () => {
                  if (
                    await call(
                      `/api/v1/integration/connectors/${connector.id}/credentials`,
                      {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ value: secret }),
                      },
                    )
                  )
                    setSecret("");
                }}
              >
                Store credential
              </button>
              <button
                className="primary-button"
                onClick={async () => {
                  const json = {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: "{}",
                  };
                  if (source.status !== "ACTIVE")
                    await call(
                      `/api/v1/integration/source-systems/${source.id}/activate`,
                      json,
                    );
                  await call(
                    `/api/v1/integration/connectors/${connector.id}/activate`,
                    json,
                  );
                }}
              >
                Activate
              </button>
            </div>
            <div className="modal-note">
              <ShieldCheck size={18} />
              Webhook: POST /api/v1/integration/hooks/{source.code}/
              {connector.id}
            </div>
          </div>
        )}
        {message && <div className="api-problem">{message}</div>}
      </section>
    </div>
  );
}

function CreateCase({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(): void;
}) {
  const auth = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewCase>({
    defaultValues: { priority: "NORMAL", currency: "GBP" },
  });
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async (data: NewCase) => {
      const body: any = {
        title: data.title,
        caseType: data.caseType,
        priority: data.priority,
      };
      if (data.externalReference)
        body.externalReference = data.externalReference;
      if (data.requestedAmount) {
        body.requestedAmountMinor = Math.round(
          Number(data.requestedAmount) * 100,
        );
        body.currency = data.currency;
      }
      const r = await auth.request("/api/v1/cases", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await problem(r);
      return r.json();
    },
    onSuccess: onCreated,
    onError: (e) => setError(e.message),
  });
  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} />
      <section className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
<<<<<<< HEAD
            <p className="eyebrow">New case</p>
=======
            <p className="eyebrow">Controlled initiation</p>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
            <h2>Create decision case</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))}>
          <div className="form-grid">
            <label>
              Title
              <input
                autoFocus
                {...register("title", { required: true, minLength: 3 })}
              />
              {errors.title && <small>Enter at least 3 characters.</small>}
            </label>
            <label>
              Case type
              <select {...register("caseType", { required: true })}>
                <option value="">Select type</option>
                <option value="COMMERCIAL_CREDIT">Commercial credit</option>
                <option value="ASSET_FINANCE">Asset finance</option>
                <option value="WORKING_CAPITAL">Working capital</option>
              </select>
            </label>
            <label>
              Priority
              <select {...register("priority")}>
                <option>NORMAL</option>
                <option>LOW</option>
                <option>HIGH</option>
                <option>URGENT</option>
              </select>
            </label>
            <label>
              External reference
              <input {...register("externalReference")} />
            </label>
            <label>
              Requested amount
              <input
                type="number"
                min="0"
                step=".01"
                {...register("requestedAmount")}
              />
            </label>
            <label>
              Currency
              <input maxLength={3} {...register("currency")} />
            </label>
          </div>
          {error && <div className="api-problem">{error}</div>}
          <div className="modal-note">
            <ShieldCheck size={18} />
<<<<<<< HEAD
            Only users with the right permission can create a case. The action
            is added to the case history.
=======
            Creation is permission-controlled and audit recorded.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={mutation.isPending}>
              Create case
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function CaseDetailPage({
  item,
  section,
  onBack,
}: {
  item: Case;
  section: CaseSection;
  onBack(): void;
}) {
  const auth = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyType, setPartyType] = useState("BORROWER");
  const [assignee, setAssignee] = useState("");
  const [role, setRole] = useState("ANALYST");
  const [reason, setReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const canReadProofs = Boolean(
    auth.identity?.permissions.includes("proof:read"),
  );
  const summaryEnabled =
    canReadProofs &&
    ["overview", "evidence", "workflow", "ledger"].includes(section);
  const proofsEnabled =
    canReadProofs && ["evidence", "ledger", "activity"].includes(section);
  const ledger = useCaseLedger(
    item.id,
    summaryEnabled,
    proofsEnabled,
    section === "ledger",
  );
  function selectSection(value: CaseSection) {
    navigate(casePath(item.id, value));
  }
  const detail = useQuery({
    queryKey: ["case", item.id],
    queryFn: async () => {
      const r = await auth.request(`/api/v1/cases/${item.id}`);
      if (!r.ok) throw await problem(r);
      return r.json() as Promise<Case>;
    },
  });
  const timeline = useQuery({
    queryKey: ["case-timeline", item.id],
    queryFn: async () => {
      const r = await auth.request(`/api/v1/cases/${item.id}/timeline`);
      if (!r.ok) throw await problem(r);
      return r.json() as Promise<Timeline[]>;
    },
    enabled: section === "activity",
  });
  const journey = useQuery({
    queryKey: ["case-integration-journey", item.id],
    queryFn: async () => {
      const r = await auth.request(
        `/api/v1/integration/cases/${item.id}/journey`,
      );
      if (!r.ok) throw await problem(r);
      return r.json() as Promise<
        Array<{
          id: string;
          eventType: string;
          processingStatus: string;
          correlationOutcome: string;
          occurredAt: string;
          summaryJson: Record<string, unknown>;
        }>
      >;
    },
    enabled: Boolean(
      section === "activity" &&
      auth.identity?.permissions.includes("integration:journey:read"),
    ),
  });
  const current = detail.data ?? item;
  async function mutate(path: string, init: RequestInit) {
    setError("");
    const r = await auth.request(path, init);
    if (!r.ok) {
      const e = await problem(r);
      setError(e.message);
      return false;
    }
    await client.invalidateQueries({ queryKey: ["case", item.id] });
    await client.invalidateQueries({ queryKey: ["case-timeline", item.id] });
    await client.invalidateQueries({ queryKey: ["cases"] });
    await client.invalidateQueries({ queryKey: ["case-register-metrics"] });
    return true;
  }
  return (
    <section className="case-page" aria-labelledby="case-page-title">
      <section className="case-hero card">
        <div className="case-hero-toolbar">
          <span>
            Decision cases <b aria-hidden="true">/</b>{" "}
            <strong>{current.caseNumber}</strong>
          </span>
          <button className="secondary-button" onClick={onBack}>
            <ArrowLeft size={16} />
            Open case register
          </button>
        </div>
        <div className="case-hero-content">
          <header className="case-page-heading">
            <span className="case-hero-icon" aria-hidden="true">
              <BriefcaseBusiness size={24} />
            </span>
            <div className="case-title-row">
              <div>
                <h1 id="case-page-title">{current.title}</h1>
                <p className="case-reference-line">
                  {current.caseNumber} · {current.caseType.replaceAll("_", " ")}
                </p>
                <p className="page-subtitle">
                  Last updated{" "}
                  {new Date(current.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            </div>
          </header>
          <div className="case-summary-grid" aria-label="Case summary">
            <div>
              <span>Requested amount</span>
              <strong>
                {current.requestedAmountMinor == null
                  ? "Not recorded"
                  : `${current.currency} ${(current.requestedAmountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              </strong>
            </div>
            <div>
              <span>Priority</span>
              <StatusBadge value={current.priority} />
            </div>
            <div>
              <span>Status</span>
              <StatusBadge value={current.status} />
            </div>
            <div>
              <span>Parties</span>
              <strong>{current.parties?.length ?? 0}</strong>
            </div>
            <div>
              <span>Assignments</span>
              <strong>{current.assignments?.length ?? 0}</strong>
            </div>
            <div>
              <span>Version</span>
              <strong>v{current.version}</strong>
            </div>
          </div>
        </div>
      </section>
      <CaseLifecycleStepper status={current.status} />
      <nav
        className="case-section-nav"
        aria-label="Case operations"
        role="tablist"
      >
        {(
          [
            ["overview", "Overview", PencilLine],
            ["parties", "Parties", Users],
            ["assignments", "Assignments", UserRoundCog],
            ["evidence", "Evidence", FileCheck2],
            ["workflow", "Workflow", Gavel],
            ["assessment", "AI assessment", BrainCircuit],
            ["ledger", "Ledger & verification", Fingerprint],
            ["activity", "Activity", History],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            role="tab"
            aria-selected={section === value}
            className={`case-section-tab ${section === value ? "case-section-tab-active" : ""}`}
            onClick={() => selectSection(value)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      {detail.isLoading ? (
        <div className="card empty-state">Loading case…</div>
      ) : detail.isError ? (
        <div className="api-problem">{detail.error.message}</div>
      ) : (
        <>
          {section === "overview" && (
            <div className="case-overview-dashboard" role="tabpanel">
              <section className="card case-page-panel overview-record-card">
                <div className="case-panel-header">
                  <div>
<<<<<<< HEAD
                    <p className="eyebrow">Case information</p>
                    <h2>Case details</h2>
                    <p>
                      Update the case title or priority here. Status changes
                      follow the case workflow.
=======
                    <p className="eyebrow">Controlled record</p>
                    <h2>Case details</h2>
                    <p>
                      Update the governed record without leaving the operational
                      overview.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                    </p>
                  </div>
                </div>
                <div className="form-grid case-edit-grid">
                  <label>
                    Title
                    <input
                      value={current.title}
                      onChange={(e) =>
                        client.setQueryData(["case", item.id], {
                          ...current,
                          title: e.target.value,
                        })
                      }
                    />
                  </label>
                  <SelectField
                    label="Priority"
                    value={current.priority}
                    onChange={(e) =>
                      client.setQueryData(["case", item.id], {
                        ...current,
                        priority: e.target.value,
                      })
                    }
                  >
                    <option>LOW</option>
                    <option>NORMAL</option>
                    <option>HIGH</option>
                    <option>URGENT</option>
                  </SelectField>
                  <label>
                    Status
                    <span className="case-readonly-value">
                      <StatusBadge value={current.status} />
                    </span>
                  </label>
                  <label>
                    Record version
                    <strong className="case-readonly-value">
                      v{current.version}
                    </strong>
                  </label>
                </div>
                <div className="case-panel-actions">
                  <PermissionGate permission="case:update">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void mutate(`/api/v1/cases/${item.id}`, {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            version: current.version,
                            title: current.title,
                            priority: current.priority,
                          }),
                        })
                      }
                    >
                      Save changes
                    </button>
                    {current.status === "DRAFT" && (
                      <button
                        className="primary-button"
                        onClick={() =>
                          void mutate(`/api/v1/cases/${item.id}`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              version: current.version,
                              status: "OPEN",
                            }),
                          })
                        }
                      >
                        Open case
                      </button>
                    )}
                  </PermissionGate>
                </div>
              </section>

              <section className="card overview-snapshot-card">
                <div className="case-panel-header">
                  <div>
<<<<<<< HEAD
                    <p className="eyebrow">At a glance</p>
                    <h2>Case summary</h2>
                    <p>Current information for this case.</p>
=======
                    <p className="eyebrow">Operational snapshot</p>
                    <h2>Record readiness</h2>
                    <p>Facts from the current tenant-scoped case record.</p>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                  </div>
                  <ShieldCheck size={22} aria-hidden="true" />
                </div>
                <dl className="overview-fact-list">
                  <div>
                    <dt>Case type</dt>
                    <dd>{current.caseType.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Lifecycle</dt>
                    <dd>
                      <StatusBadge value={current.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Related parties</dt>
                    <dd>{current.parties?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Assignments</dt>
                    <dd>{current.assignments?.length ?? 0}</dd>
                  </div>
                </dl>
              </section>

              {canReadProofs && (
                <div className="card overview-ledger-card">
                  <CaseLedgerSummary
                    ledger={ledger}
                    onOpen={() => selectSection("ledger")}
                  />
                </div>
              )}

              <section className="card overview-workspaces-card">
                <div className="case-panel-header">
                  <div>
                    <p className="eyebrow">Case operations</p>
                    <h2>Workspaces</h2>
<<<<<<< HEAD
                    <p>Choose the area you want to work in.</p>
=======
                    <p>
                      Open a focused operation without a multi-purpose dialog.
                    </p>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                  </div>
                </div>
                <div className="overview-workspace-links">
                  {[
                    ["evidence", "Evidence", "Assets, versions and integrity"],
                    ["workflow", "Workflow", "Validation, review and approval"],
                    [
                      "assessment",
                      "AI assessment",
<<<<<<< HEAD
                      "Findings for human review",
=======
                      "Governed decision support",
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                    ],
                    ["ledger", "Ledger", "Proofs and verification"],
                  ].map(([target, label, description]) => (
                    <button
                      type="button"
                      key={target}
                      onClick={() => selectSection(target as CaseSection)}
                    >
                      <span>
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </span>
                      <span aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
          {section === "parties" && (
            <div className="card case-page-panel" role="tabpanel">
              <div className="case-panel-header">
                <div>
                  <h2>Related parties</h2>
                  <p>
                    Borrowers, guarantors, directors, and other participants.
                  </p>
                </div>
              </div>
              <div className="detail-section case-entity-section">
                {current.parties?.length ? (
                  current.parties.map((p) => (
                    <div className="control-row" key={p.id}>
                      <span>{p.displayName}</span>
                      <strong>{p.partyType}</strong>
                    </div>
                  ))
                ) : (
                  <p className="muted-cell">No parties linked.</p>
                )}
                <PermissionGate permission="case:update">
                  <div className="inline-form">
                    <input
                      placeholder="Party name"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                    />
                    <select
                      value={partyType}
                      onChange={(e) => setPartyType(e.target.value)}
                    >
                      <option>BORROWER</option>
                      <option>GUARANTOR</option>
                      <option>DIRECTOR</option>
                      <option>OTHER</option>
                    </select>
                    <button
                      className="secondary-button"
                      onClick={async () => {
                        if (
                          await mutate(`/api/v1/cases/${item.id}/parties`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              displayName: partyName,
                              partyType,
                            }),
                          })
                        )
                          setPartyName("");
                      }}
                    >
                      Add party
                    </button>
                  </div>
                </PermissionGate>
              </div>
            </div>
          )}
          {section === "assignments" && (
            <div className="card case-page-panel" role="tabpanel">
              <div className="case-panel-header">
                <div>
                  <h2>Case assignments</h2>
                  <p>
<<<<<<< HEAD
                    People responsible for working on or reviewing this case.
=======
                    Ownership and operational responsibilities for this case.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                  </p>
                </div>
              </div>
              <div className="detail-section case-entity-section">
                {current.assignments?.length ? (
                  current.assignments.map((a) => (
                    <div className="control-row" key={a.id}>
                      <span>{a.userId}</span>
                      <strong>{a.role}</strong>
                      <PermissionGate permission="case:assign">
                        <button
                          className="text-button"
                          onClick={() =>
                            void mutate(
                              `/api/v1/cases/${item.id}/assignments/${a.id}`,
                              { method: "DELETE" },
                            )
                          }
                        >
                          Remove
                        </button>
                      </PermissionGate>
                    </div>
                  ))
                ) : (
                  <p className="muted-cell">No assignments.</p>
                )}
                <PermissionGate permission="case:assign">
                  <div className="inline-form">
                    <input
<<<<<<< HEAD
                      placeholder="User ID"
=======
                      placeholder="Stable user UUID"
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    />
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option>OWNER</option>
                      <option>ANALYST</option>
                      <option>REVIEWER</option>
                      <option>OBSERVER</option>
                    </select>
                    <button
                      className="secondary-button"
                      onClick={async () => {
                        if (
                          await mutate(`/api/v1/cases/${item.id}/assignments`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ userId: assignee, role }),
                          })
                        )
                          setAssignee("");
                      }}
                    >
                      Assign
                    </button>
                  </div>
                </PermissionGate>
              </div>
            </div>
          )}
          {section === "evidence" && (
            <div role="tabpanel">
              <PermissionGate permission="evidence:read">
                <EvidencePanel
                  caseId={item.id}
                  ledger={canReadProofs ? ledger : undefined}
                  onOpenLedger={() => selectSection("ledger")}
                />
              </PermissionGate>
            </div>
          )}
          {section === "workflow" && (
            <div role="tabpanel">
              <PermissionGate permission="workflow:read">
                <WorkflowPanel
                  caseId={item.id}
                  ledger={canReadProofs ? ledger : undefined}
                  onOpenLedger={() => selectSection("ledger")}
                />
              </PermissionGate>
            </div>
          )}
          {section === "assessment" && (
            <div role="tabpanel">
              <PermissionGate permission="assessment:read">
                <AiAssessmentPanel caseId={item.id} />
              </PermissionGate>
            </div>
          )}
          {section === "ledger" && (
            <div role="tabpanel">
              {canReadProofs ? (
                <CaseLedgerTab ledger={ledger} />
              ) : (
                <div className="card permission-state" role="alert">
                  <h2>Ledger access unavailable</h2>
                  <p>
                    Your role does not include permission to read case proofs.
                    No ledger data was requested.
                  </p>
                </div>
              )}
            </div>
          )}
          {section === "activity" && (
            <div className="card case-page-panel" role="tabpanel">
              <div className="case-panel-header">
                <div>
                  <h2>Case activity</h2>
<<<<<<< HEAD
                  <p>
                    Status changes and records received from connected systems.
                  </p>
=======
                  <p>Status history and linked source-system journey.</p>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                </div>
              </div>
              <div className="detail-section case-activity-section">
                <h3>Status timeline</h3>
                {timeline.data?.map((t) => (
                  <div className="control-row" key={t.id}>
                    <span>{new Date(t.changedAt).toLocaleString()}</span>
                    <strong>
                      {t.fromStatus ?? "CREATED"} → {t.toStatus}
                    </strong>
                    {t.reason && <small>{t.reason}</small>}
                  </div>
                ))}
              </div>
              <PermissionGate permission="integration:journey:read">
                <div className="detail-section">
<<<<<<< HEAD
                  <h3>Source activity</h3>
=======
                  <h3>Source decision journey</h3>
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                  {journey.isLoading ? (
                    <p className="muted-cell">Loading integration journey…</p>
                  ) : journey.data?.length ? (
                    journey.data.map((event) => (
                      <div className="control-row" key={event.id}>
                        <span>
                          {new Date(event.occurredAt).toLocaleString()}
                        </span>
                        <strong>{event.eventType}</strong>
                        <small>
                          {event.processingStatus} · {event.correlationOutcome}
                        </small>
                      </div>
                    ))
                  ) : (
                    <p className="muted-cell">
<<<<<<< HEAD
                      No source records are linked to this case.
=======
                      No source triggers are linked to this case.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
                    </p>
                  )}
                </div>
              </PermissionGate>
              {canReadProofs && <LedgerActivity ledger={ledger} />}
            </div>
          )}
          {section === "overview" && current.status !== "CANCELLED" && (
            <PermissionGate permission="case:cancel">
              <div className="card case-danger-panel">
                <div>
                  <h3>Cancel this case</h3>
                  <p>
                    Cancellation is permanent and requires a recorded reason.
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => setCancelOpen(true)}
                >
                  Review cancellation
                </button>
              </div>
            </PermissionGate>
          )}
        </>
      )}
      {error && <div className="api-problem">{error}</div>}
      {cancelOpen && (
        <div className="modal-layer">
          <button
            className="modal-backdrop"
            onClick={() => setCancelOpen(false)}
            aria-label="Close cancellation confirmation"
          />
          <section
            className="modal-card case-confirmation-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-case-title"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Permanent action</p>
                <h2 id="cancel-case-title">Cancel decision case?</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setCancelOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="case-confirmation-body">
              <p>
                This will cancel <strong>{current.caseNumber}</strong>. The
                reason becomes part of the case history.
              </p>
              <label>
                Cancellation reason
                <textarea
                  rows={4}
                  placeholder="Explain why this case is being cancelled"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setCancelOpen(false)}
              >
                Keep case
              </button>
              <button
                className="danger-button"
                disabled={reason.trim().length < 3}
                onClick={async () => {
                  if (
                    await mutate(`/api/v1/cases/${item.id}/cancel`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        version: current.version,
                        reason,
                      }),
                    })
                  ) {
                    setCancelOpen(false);
                    setReason("");
                  }
                }}
              >
                Confirm cancellation
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
async function problem(response: Response) {
  const data = await response.json().catch(() => ({}));
  const e = new Error(
    data.detail ?? data.message ?? `Request failed (${response.status})`,
  );
  return e;
}
