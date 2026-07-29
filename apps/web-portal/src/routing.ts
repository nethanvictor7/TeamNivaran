export type WorkspaceRoute =
<<<<<<< HEAD
  "cases" | "integrations" | "workflow" | "ai-governance" | "audit";
=======
  "cases" | "integrations" | "workflow" | "ai-governance";
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d

export type CaseSection =
  | "overview"
  | "parties"
  | "assignments"
  | "evidence"
  | "workflow"
  | "assessment"
  | "ledger"
  | "activity";

export const caseSections: CaseSection[] = [
  "overview",
  "parties",
  "assignments",
  "evidence",
  "workflow",
  "assessment",
  "ledger",
  "activity",
];
const caseStatuses = [
  "DRAFT",
  "OPEN",
  "EVIDENCE_COLLECTION",
  "UNDER_REVIEW",
  "DECISION_PENDING",
  "DECIDED",
  "CLOSED",
  "CANCELLED",
];
const casePriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];

export type PortalRoute = {
  workspace: WorkspaceRoute;
  caseId: string | null;
  section: CaseSection;
  search: string;
  status: string;
  priority: string;
  page: number;
};

export function parsePortalRoute(
  url: Pick<Location, "pathname" | "search" | "hash">,
): PortalRoute {
  const parts = url.pathname.split("/").filter(Boolean);
  const legacy = new URLSearchParams(url.hash.replace(/^#/, ""));
  const workspace: WorkspaceRoute =
    parts[0] === "integrations"
      ? "integrations"
      : parts[0] === "workflow"
        ? "workflow"
        : parts[0] === "ai-governance"
          ? "ai-governance"
<<<<<<< HEAD
          : parts[0] === "audit"
            ? "audit"
            : "cases";
=======
          : "cases";
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
  const caseId =
    workspace === "cases" ? (parts[1] ?? legacy.get("case")) : null;
  const candidate = parts[2] ?? legacy.get("section") ?? "overview";
  const section = caseSections.includes(candidate as CaseSection)
    ? (candidate as CaseSection)
    : "overview";
  const query = new URLSearchParams(url.search);
  const page = Number(query.get("page") ?? "1");
  const status = query.get("status") ?? "";
  const priority = query.get("priority") ?? "";
  return {
    workspace,
    caseId,
    section,
    search: query.get("search") ?? "",
    status: caseStatuses.includes(status) ? status : "",
    priority: casePriorities.includes(priority) ? priority : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function casePath(caseId: string, section: CaseSection) {
  return `/cases/${encodeURIComponent(caseId)}/${section}`;
}

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}
