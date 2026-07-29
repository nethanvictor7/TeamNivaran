import {
  Bell,
  BrainCircuit,
  BriefcaseBusiness,
  Cable,
  ClipboardList,
  Gavel,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PermissionGate, useAuth } from "./auth";
import { navigate } from "./routing";

export type PortalWorkspace =
  "cases" | "integrations" | "workflow" | "ai-governance" | "audit";

type NavigationItem = {
  workspace: PortalWorkspace;
  label: string;
  path: string;
  icon: LucideIcon;
  permission?: string;
};

const navigationItems: NavigationItem[] = [
  {
    workspace: "cases",
    label: "Decision cases",
    path: "/cases",
    icon: BriefcaseBusiness,
  },
  {
    workspace: "integrations",
    label: "Integrations",
    path: "/integrations",
    icon: Cable,
    permission: "integration:source:read",
  },
  {
    workspace: "workflow",
    label: "Workflow queue",
    path: "/workflow",
    icon: Gavel,
    permission: "workflow:task:read",
  },
  {
    workspace: "ai-governance",
    label: "AI governance",
    path: "/ai-governance",
    icon: BrainCircuit,
    permission: "ai-governance:read",
  },
  {
    workspace: "audit",
    label: "Audit & reports",
    path: "/audit",
    icon: ClipboardList,
    permission: "audit:search",
  },
];

const workspaceTitles: Record<PortalWorkspace, string> = {
  cases: "Decision cases",
  integrations: "Integrations",
  workflow: "Workflow queue",
  "ai-governance": "AI governance",
  audit: "Audit & reports",
};

function initials(value: string | undefined) {
  if (!value) return "CD";
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ApplicationShell({
  activeWorkspace,
  children,
}: {
  activeWorkspace: PortalWorkspace;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const avatar = useMemo(
    () => initials(auth.identity?.displayName),
    [auth.identity?.displayName],
  );

  useEffect(() => {
    setMobileOpen(false);
    document.title = `${workspaceTitles[activeWorkspace]} — Aegis`;
    return () => {
      document.title = "Aegis — Decision Evidence Vault";
    };
  }, [activeWorkspace]);

  useEffect(() => {
    if (!mobileOpen || !sidebar.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = sidebar.current;
    root.querySelector<HTMLElement>("button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
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
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", handleKeyDown);
    return () => {
      root.removeEventListener("keydown", handleKeyDown);
      (previous ?? menuButton.current)?.focus();
    };
  }, [mobileOpen]);

  return (
    <div
      className={`app-shell operational-shell ${collapsed ? "shell-collapsed" : ""}`}
    >
      {mobileOpen && (
        <button
          type="button"
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        ref={sidebar}
        className={`sidebar operational-sidebar ${mobileOpen ? "sidebar-open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShieldCheck size={21} />
          </span>
          <div className="brand-copy">
            <div className="brand-name">Aegis</div>
            <div className="brand-caption">
              Decision Evidence
              <br />
              Vault
            </div>
          </div>
          <button
            type="button"
            className="icon-button mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="primary-navigation" aria-label="Core modules">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const button = (
              <button
                type="button"
                className={`nav-item ${
                  activeWorkspace === item.workspace ? "nav-item-active" : ""
                }`}
                aria-current={
                  activeWorkspace === item.workspace ? "page" : undefined
                }
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
            return item.permission ? (
              <PermissionGate key={item.workspace} permission={item.permission}>
                {button}
              </PermissionGate>
            ) : (
              <span key={item.workspace}>{button}</span>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <section className="sidebar-user-card" aria-label="Signed-in user">
            <div className="sidebar-user-identity">
              <span className="profile-avatar" aria-hidden="true">
                {avatar}
              </span>
              <span className="sidebar-user-copy">
                <strong>{auth.identity?.displayName}</strong>
                <small>{auth.identity?.email}</small>
              </span>
            </div>
            <div className="sidebar-user-actions">
              <button
                type="button"
                className="sidebar-user-action"
                aria-label="Notifications: no unread alerts"
                title="No unread alerts"
              >
                <Bell size={16} aria-hidden="true" />
                <span>Alerts</span>
              </button>
              <button
                type="button"
                className="sidebar-user-action"
                onClick={() => void auth.logout()}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={16} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </div>
          </section>
          <div className="environment-row">
            <span className="environment-dot" />
            <span>Controlled environment</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={16} aria-hidden="true" />
            )}
            <span>{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>
      <main className="main-content operational-main">
        <div className="controlled-banner" role="status">
          <button
            ref={menuButton}
            type="button"
            className="icon-button controlled-menu-button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu size={19} />
          </button>
          <ShieldCheck size={14} aria-hidden="true" />
          <span>Organisation data is separated</span>
          <span>Activity recording is on</span>
        </div>
        {children}
        <footer className="application-footer">
          <span>
            <ShieldCheck size={13} aria-hidden="true" />
            Secure workspace
          </span>
          <span>Important actions are recorded</span>
          <span>Aegis v2.1.0</span>
        </footer>
      </main>
    </div>
  );
}
