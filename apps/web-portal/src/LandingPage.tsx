import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleUserRound,
  DatabaseZap,
  FileCheck2,
  FileLock2,
  Fingerprint,
  Gavel,
  History,
  KeyRound,
  Layers3,
  Link2,
  ListChecks,
  LockKeyhole,
  LogIn,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "./auth";

type Login = { email: string; password: string };

type AegisModule = {
  icon: LucideIcon;
  number: string;
  title: string;
  description: string;
  capabilities: string[];
};

const aegisModules: AegisModule[] = [
  {
    icon: BriefcaseBusiness,
    number: "01",
    title: "Decision cases",
    description:
      "Keep the request, customer details, owner, amount, priority and status together from day one.",
    capabilities: [
      "Create and manage cases",
      "Add parties and owners",
      "Track status and priority",
    ],
  },
  {
    icon: DatabaseZap,
    number: "02",
    title: "Connected sources",
    description:
      "Bring in approved records from business systems without losing where they came from.",
    capabilities: [
      "Receive business records",
      "Collect from read-only sources",
      "Resolve unmatched records",
    ],
  },
  {
    icon: FileLock2,
    number: "03",
    title: "Evidence vault",
    description:
      "Upload, classify and check documents. Replacements create a new version, so the earlier record is never lost.",
    capabilities: [
      "Safe document upload",
      "Full version history",
      "Access and integrity checks",
    ],
  },
  {
    icon: ListChecks,
    number: "04",
    title: "Checks and approvals",
    description:
      "Run the same checks every time, return missing items for correction and send ready cases to the right reviewer.",
    capabilities: [
      "Repeatable case checks",
      "Review and correction tasks",
      "Independent approval",
    ],
  },
  {
    icon: BrainCircuit,
    number: "05",
    title: "Decision support",
    description:
      "Review findings from selected evidence. The reviewer decides what to use, and Aegis never approves a case.",
    capabilities: [
      "Evidence-based findings",
      "Reviewer-owned recommendations",
      "Controlled policies and settings",
    ],
  },
  {
    icon: BadgeCheck,
    number: "06",
    title: "Proof and reporting",
    description:
      "See the full case history, verify the evidence behind a decision and create reports for audit or review.",
    capabilities: [
      "Independent proof checks",
      "Complete case history",
      "Controlled reports and exports",
    ],
  },
];

const decisionSteps = [
  {
    label: "Open",
    detail: "Create the case and add the people responsible for it.",
    icon: BriefcaseBusiness,
  },
  {
    label: "Gather",
    detail: "Bring in the records and documents needed for the review.",
    icon: FileLock2,
  },
  {
    label: "Check",
    detail: "Confirm the case is complete and meets the required rules.",
    icon: ScanSearch,
  },
  {
    label: "Review",
    detail: "Prepare the recommendation and send it for approval.",
    icon: Gavel,
  },
  {
    label: "Complete",
    detail: "Record the outcome and keep the full history ready for audit.",
    icon: Fingerprint,
  },
];

const useCases = [
  {
    icon: BriefcaseBusiness,
    title: "New applications",
    description:
      "Manage the application, supporting documents, review and approval in one case.",
  },
  {
    icon: History,
    title: "Renewals and changes",
    description:
      "Add current information without changing the record used for the earlier decision.",
  },
  {
    icon: Gavel,
    title: "Policy exceptions",
    description:
      "Record the reason, apply extra checks and route the case to the correct approver.",
  },
  {
    icon: ScrollText,
    title: "Audits and complaints",
    description:
      "Show what the team knew, checked, recommended and approved at the time.",
  },
];

const faqs = [
  {
    question: "What is Aegis?",
    answer:
      "Aegis keeps the full record of a credit decision in one place. Instead of passing information between email, spreadsheets and shared folders, the team works from the same case, evidence and history.",
  },
  {
    question: "Who uses Aegis?",
    answer:
      "Credit analysts, underwriters, reviewers, approvers, operations teams, risk, compliance and audit teams use Aegis. Each person only sees the information and actions allowed for their role.",
  },
  {
    question: "How does a case move through Aegis?",
    answer:
      "The team opens a case, adds the customer and supporting evidence, completes the required checks and prepares a recommendation. An authorised approver records the outcome, and Aegis keeps the full history.",
  },
  {
    question: "How does Aegis connect to other systems?",
    answer:
      "Aegis can receive records from approved integrations or collect selected data from read-only sources. Every record keeps its source reference. Anything that cannot be matched safely is held for a person to review.",
  },
  {
    question: "How does Aegis protect evidence?",
    answer:
      "Uploaded files are checked, classified and given a unique fingerprint. A document is never silently overwritten. Any replacement creates a new version, and access or download activity is recorded.",
  },
  {
    question: "How do checks and approvals work?",
    answer:
      "Aegis runs the checks configured for that case type. Missing or failed items create clear follow-up tasks. Where independent approval is required, the person who made the recommendation cannot approve it.",
  },
  {
    question: "What does decision support do?",
    answer:
      "Assessment can highlight findings, missing information and risk indicators from the evidence selected by the reviewer. It cannot approve, reject or submit a decision. A person remains responsible for the recommendation and outcome.",
  },
  {
    question: "What is a proof?",
    answer:
      "A proof lets an authorised user confirm that an evidence version or completed decision still matches the original record. A mismatch is shown as a control issue; an unavailable check is shown separately and can be tried again.",
  },
  {
    question: "What can audit and compliance teams review?",
    answer:
      "They can search activity, open the full journey for a case and see who performed each action. Reports and exports include their request history, data range, row count, checksum and expiry.",
  },
  {
    question: "How does Aegis keep organisations separate?",
    answer:
      "Every record belongs to one organisation, and Aegis checks that boundary whenever information is viewed or changed. Permissions protect sensitive actions, and important activity records the user, time, result and affected record.",
  },
  {
    question: "What types of cases can Aegis handle?",
    answer:
      "Aegis can support new applications, renewals, annual reviews, limit changes, policy exceptions, reconsiderations, complaints, disputes and audit samples. Each case keeps the rules and configuration used at the time.",
  },
  {
    question: "What happens if a service is interrupted?",
    answer:
      "Aegis records the progress of longer-running work and uses request references to avoid duplicate results. If a service is interrupted, existing case information stays available and unsafe actions remain disabled until the service recovers.",
  },
];

const assuranceItems = [
  {
    icon: FileCheck2,
    label: "Version history",
    detail: "Nothing is overwritten",
  },
  { icon: Activity, label: "Clear history", detail: "See who did what" },
  {
    icon: LockKeyhole,
    label: "Controlled access",
    detail: "Role-based access",
  },
  {
    icon: UsersRound,
    label: "Human approval",
    detail: "People stay accountable",
  },
];

export function LandingPage() {
  const auth = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Login>();

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLoginOpen(false);
    };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, []);

  return (
    <main className={`aegis-landing ${loginOpen ? "" : "aegis-login-closed"}`}>
      <div className="aegis-main-column">
        <section className="aegis-hero" id="home">
          <header className="aegis-header">
            <a className="aegis-brand" href="#home" aria-label="Aegis home">
              <span className="aegis-brand-mark" aria-hidden="true">
                <ShieldCheck size={23} />
              </span>
              <span>
                <strong>Aegis</strong>
                <small>Decision Evidence Vault</small>
              </span>
            </a>
            <nav className="aegis-nav" aria-label="Landing page">
              <a href="#aegis">Aegis</a>
              <a href="#capabilities">Capabilities</a>
              <a href="#use-cases">Use cases</a>
              <a href="#faq">FAQ</a>
            </nav>
            <button
              type="button"
              className="aegis-login-trigger"
              onClick={() => setLoginOpen(true)}
              aria-expanded={loginOpen}
            >
              <CircleUserRound size={17} aria-hidden="true" />
              Login
            </button>
          </header>

          <div className="aegis-hero-grid">
            <div className="aegis-hero-copy">
              <p className="aegis-eyebrow">
                Aegis for controlled credit decisions
              </p>
              <h1>Keep every decision in one clear record.</h1>
              <p>
                Collect the evidence, complete the checks, record the approval
                and keep the full history together from start to finish.
              </p>
              <div className="aegis-hero-actions">
                <a className="aegis-primary-action" href="#aegis">
                  See how Aegis works
                  <ArrowRight size={17} aria-hidden="true" />
                </a>
                <a className="aegis-secondary-action" href="#faq">
                  Common questions
                  <ArrowRight size={17} aria-hidden="true" />
                </a>
              </div>
            </div>

            <div
              className="aegis-visual"
              role="img"
              aria-label="AI-assisted evidence validation and ledger-backed decision proof"
            >
              <img src="/aegis-hero-ai-ledger-v1.png" alt="" />
              <article className="aegis-float-card aegis-ai-card">
                <div className="aegis-card-title">
                  <span>AI-assisted validation</span>
                  <BrainCircuit size={15} />
                </div>
                <div className="aegis-ai-card-body">
                  <span>
                    <Check size={11} />
                    Evidence grounded
                  </span>
                  <dl>
                    <div>
                      <dt>Assessment</dt>
                      <dd>Complete</dd>
                    </div>
                    <div>
                      <dt>Evidence</dt>
                      <dd>12 versions</dd>
                    </div>
                    <div>
                      <dt>Human review</dt>
                      <dd>Required</dd>
                    </div>
                  </dl>
                </div>
              </article>
              <article className="aegis-float-card aegis-decision-card">
                <div>
                  <small>Executive decision pack</small>
                  <span className="aegis-verified">
                    <Check size={11} />
                    Verified
                  </span>
                </div>
                <strong>Case AEG-02417</strong>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>Approved</dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>28 items</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>Today, 14:32</dd>
                  </div>
                </dl>
              </article>
              <article className="aegis-float-card aegis-audit-card aegis-ledger-card">
                <div className="aegis-card-title">
                  <span>Ledger proof</span>
                  <Link2 size={15} />
                </div>
                <ol>
                  <li>
                    <Check size={11} />
                    <span>
                      <strong>Evidence proof</strong>
                      Confirmed
                    </span>
                  </li>
                  <li>
                    <Check size={11} />
                    <span>
                      <strong>Decision proof</strong>
                      Registered
                    </span>
                  </li>
                  <li>
                    <Check size={11} />
                    <span>
                      <strong>Independent check</strong>
                      Match
                    </span>
                  </li>
                </ol>
              </article>
            </div>
          </div>

          <div className="aegis-assurance-strip">
            {assuranceItems.map(({ icon: Icon, label, detail }) => (
              <article key={label}>
                <Icon size={27} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="aegis-product-intro" id="aegis">
          <div className="aegis-section-heading">
            <div>
              <p className="aegis-section-label">What Aegis brings together</p>
              <h2>Everything the team needs to work a case.</h2>
            </div>
            <p>
              The case stays the same from the first request to final approval.
              Documents, checks, comments and decisions all sit against that
              record.
            </p>
          </div>

          <div className="aegis-module-grid" id="capabilities">
            {aegisModules.map(
              ({ icon: Icon, number, title, description, capabilities }) => (
                <article key={title}>
                  <div className="aegis-module-topline">
                    <span className="aegis-module-icon">
                      <Icon size={22} aria-hidden="true" />
                    </span>
                    <small>{number}</small>
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <ul>
                    {capabilities.map((capability) => (
                      <li key={capability}>
                        <Check size={13} aria-hidden="true" />
                        {capability}
                      </li>
                    ))}
                  </ul>
                </article>
              ),
            )}
          </div>
        </section>

        <section className="aegis-decision-flow">
          <div className="aegis-flow-heading">
            <p className="aegis-section-label">How it works</p>
            <h2>Five clear steps from request to outcome</h2>
            <p>
              Everyone works from the same case and can see what is ready, what
              is missing and what happens next.
            </p>
          </div>
          <ol>
            {decisionSteps.map(({ label, detail, icon: Icon }, index) => (
              <li key={label}>
                <span className="aegis-flow-icon">
                  <Icon size={21} aria-hidden="true" />
                </span>
                <small>0{index + 1}</small>
                <strong>{label}</strong>
                <p>{detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="aegis-use-cases" id="use-cases">
          <div className="aegis-section-heading">
            <div>
              <p className="aegis-section-label">Common use cases</p>
              <h2>Built for the work credit teams already do.</h2>
            </div>
            <p>
              Use the same case structure and controls for day-to-day decisions,
              exceptions and later reviews.
            </p>
          </div>
          <div className="aegis-use-case-grid">
            {useCases.map(({ icon: Icon, title, description }) => (
              <article key={title}>
                <Icon size={23} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="aegis-faq-section" id="faq">
          <div className="aegis-faq-intro">
            <p className="aegis-section-label">Questions teams usually ask</p>
            <h2>Straight answers about Aegis.</h2>
            <p>
              A practical overview of how cases, evidence, reviews, approvals
              and audit records work.
            </p>
            <div className="aegis-faq-stat">
              <span>
                <Layers3 size={18} aria-hidden="true" />6 connected areas
              </span>
              <span>
                <KeyRound size={18} aria-hidden="true" />
                Access, audit and approval controls
              </span>
            </div>
          </div>
          <div className="aegis-faq-list">
            {faqs.map((item, index) => (
              <details key={item.question} open={index === 0}>
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.question}</strong>
                  <ChevronDown size={19} aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className="aegis-footer">
          <a className="aegis-brand" href="#home">
            <span className="aegis-brand-mark" aria-hidden="true">
              <ShieldCheck size={21} />
            </span>
            <span>
              <strong>Aegis</strong>
              <small>Decision Evidence Vault</small>
            </span>
          </a>
          <p>Controlled, traceable credit decision operations.</p>
          <a href="#faq">Aegis FAQ</a>
        </footer>
      </div>

      {loginOpen && (
        <>
          <button
            className="aegis-login-scrim"
            type="button"
            onClick={() => setLoginOpen(false)}
            aria-label="Close sign in"
          />
          <aside className="aegis-signin-panel" aria-label="Aegis sign in">
            <button
              type="button"
              className="aegis-signin-close"
              onClick={() => setLoginOpen(false)}
              aria-label="Close sign in"
            >
              <X size={22} />
            </button>
            <div className="aegis-signin-brand">
              <span className="aegis-brand-mark" aria-hidden="true">
                <ShieldCheck size={26} />
              </span>
              <div>
                <strong>Aegis</strong>
                <small>Decision Evidence Vault</small>
              </div>
            </div>
            <div className="aegis-signin-heading">
              <h2>Sign in</h2>
              <p>Access your secure workspace.</p>
            </div>
            <form
              onSubmit={handleSubmit(async (data) => {
                setError("");
                try {
                  await auth.login(data.email, data.password);
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "Login failed.",
                  );
                }
              })}
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  {...register("email", { required: true })}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  {...register("password", { required: true, minLength: 12 })}
                />
              </label>
              {error && (
                <div className="aegis-signin-error" role="alert">
                  {error}
                </div>
              )}
              <button className="aegis-signin-submit" disabled={isSubmitting}>
                <LogIn size={17} aria-hidden="true" />
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <div className="aegis-signin-assurance">
              <ShieldCheck size={20} aria-hidden="true" />
              <span>
                <strong>Your data is protected</strong>
                Access is limited by organization and role.
              </span>
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
