import type { CaseProof } from "@cdep/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import {
  formatGovernanceBytes,
  runtimeOutcomeLabel,
} from "../src/AiAssessment";
import { ledgerPollInterval } from "../src/CaseLedger";
import { caseLifecycleStage, caseStagePresentation } from "../src/App";
import {
  EvidenceProofStatus,
  ProofDetailsDrawer,
  ProofStatusBadge,
  ProofVerificationPanel,
  RetryProofDialog,
  TransactionReference,
  formatLedgerTimestamp,
  proofStatusPresentation,
} from "../src/LedgerProofs";
import { casePath, parsePortalRoute } from "../src/routing";
import {
  ConfirmationDialog,
  CopyIdentifier,
  SelectField,
  StatusBadge,
  statusPresentation,
} from "../src/ui";

describe("AI governance presentation", () => {
  it("formats runtime limits and deterministic outcomes", () => {
    expect(formatGovernanceBytes(1_048_576)).toBe("1 MB");
    expect(formatGovernanceBytes(1_572_864)).toBe("1.5 MB");
    expect(formatGovernanceBytes(524_288)).toBe("512 KB");
    expect(runtimeOutcomeLabel("DELAYED_RESULT")).toBe("DELAYED RESULT");
  });
});

const proof: CaseProof = {
  proofRequestId: "11111111-1111-4111-8111-111111111111",
  proofId: "22222222-2222-4222-8222-222222222222",
  proofType: "EVIDENCE",
  eligibility: "ANCHOR_REQUESTED",
  lifecycle: "CONFIRMED",
  storedState: "CONFIRMED",
  retryable: false,
  attemptCount: 1,
  safeFailureCode: null,
  evidenceId: "33333333-3333-4333-8333-333333333333",
  evidenceVersionId: "44444444-4444-4444-8444-444444444444",
  decisionId: null,
  decisionOutcome: null,
  previousProofId: null,
  provider: {
    providerType: "FABRIC",
    transactionId: "fabric-transaction-reference",
    proofReference: "provider-proof",
    contractReference: "cdep-proof-registry",
    networkReference: "cdep-proof-channel",
  },
  verification: {
    offLedgerHash: "MATCH",
    ledgerConfirmation: "CONFIRMED",
    ledgerHash: "MATCH",
    overallVerified: true,
    providerState: "FINALIZED",
    safeErrorCode: null,
    verifiedAt: "2026-07-27T00:00:00.000Z",
    requestedBy: "55555555-5555-4555-8555-555555555555",
  },
  requestedAt: "2026-07-27T00:00:00.000Z",
  submittedAt: "2026-07-27T00:00:01.000Z",
  finalizedAt: "2026-07-27T00:00:02.000Z",
  requestedBy: "55555555-5555-4555-8555-555555555555",
  history: [],
};

describe("provider-neutral proof presentation", () => {
  it.each([
    [null, "NOT_ELIGIBLE", false, "Not eligible"],
    [null, "ELIGIBLE_NOT_ANCHORED", false, "Eligible — not yet anchored"],
    [null, undefined, false, "No proof found"],
    ["PENDING", "ANCHOR_REQUESTED", false, "Anchor pending"],
    ["SUBMITTED", "ANCHOR_REQUESTED", false, "Submitted"],
    ["CONFIRMED", "ANCHOR_REQUESTED", false, "Confirmed"],
    ["FAILED", "ANCHOR_REQUESTED", true, "Failed — retry available"],
    ["FAILED", "ANCHOR_REQUESTED", false, "Failed — permanent"],
  ] as const)(
    "maps %s/%s to %s",
    (lifecycle, eligibility, retryable, expected) => {
      expect(
        proofStatusPresentation(lifecycle, eligibility, retryable).label,
      ).toBe(expected);
    },
  );

  it("renders status text and all independent verification dimensions", () => {
    render(
      <>
        <ProofStatusBadge
          lifecycle="CONFIRMED"
          eligibility="ANCHOR_REQUESTED"
        />
        <EvidenceProofStatus
          lifecycle={null}
          eligibility="ELIGIBLE_NOT_ANCHORED"
        />
        <ProofVerificationPanel proof={proof} />
      </>,
    );
    expect(screen.getByText("Confirmed")).toBeVisible();
    expect(screen.getByText("Eligible — not yet anchored")).toBeVisible();
    expect(screen.getByText("Off-ledger hash")).toBeVisible();
    expect(screen.getByText("Ledger confirmation")).toBeVisible();
    expect(screen.getByText("Ledger hash")).toBeVisible();
  });

  it("guards nullable and malformed timestamps", () => {
    expect(formatLedgerTimestamp(null)).toBe("Not recorded");
    expect(formatLedgerTimestamp("not-a-date")).toBe("Invalid timestamp");
    expect(formatLedgerTimestamp(proof.finalizedAt)).toMatch(/UTC$/);
  });
});

describe("ledger dialog interactions", () => {
  it("has no serious or critical automated accessibility violations", async () => {
    const { container } = render(
      <main>
        <h1>Ledger &amp; Verification</h1>
        <ProofStatusBadge
          lifecycle="CONFIRMED"
          eligibility="ANCHOR_REQUESTED"
        />
        <ProofVerificationPanel proof={proof} />
      </main>,
    );
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });

  it("closes the proof drawer with Escape and restores focus", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = render(
      <ProofDetailsDrawer
        proof={proof}
        canVerify
        canRetry={false}
        busy={false}
        disabled={false}
        onClose={onClose}
        onVerify={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Close proof details")).toHaveFocus(),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(
      <ProofDetailsDrawer
        proof={null}
        canVerify
        canRetry={false}
        busy={false}
        disabled={false}
        onClose={onClose}
        onVerify={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("requires explicit retry confirmation and supports Escape", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <RetryProofDialog
        proof={{ ...proof, lifecycle: "FAILED", retryable: true }}
        busy={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm retry" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("copies the complete safe transaction reference with feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<TransactionReference transactionId="complete-safe-reference" />);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Copy full transaction reference",
      }),
    );
    expect(writeText).toHaveBeenCalledWith("complete-safe-reference");
    expect(
      screen.getByText("Transaction reference copied"),
    ).toBeInTheDocument();
  });
});

describe("routing and polling", () => {
  it("parses addressable case tabs and legacy links", () => {
    expect(
      parsePortalRoute({
        pathname: "/cases/case-id/ledger",
        search: "?search=smith",
        hash: "",
      }),
    ).toEqual({
      workspace: "cases",
      caseId: "case-id",
      section: "ledger",
      search: "smith",
      status: "",
      priority: "",
      page: 1,
    });
    expect(
      parsePortalRoute({
        pathname: "/",
        search: "",
        hash: "#case=legacy-id&section=evidence",
      }).section,
    ).toBe("evidence");
    expect(
      parsePortalRoute({
        pathname: "/cases",
        search: "?status=DROP_TABLE&priority=ROOT&page=-4",
        hash: "",
      }),
    ).toMatchObject({ status: "", priority: "", page: 1 });
    expect(casePath("case id", "activity")).toBe("/cases/case%20id/activity");
    expect(
      parsePortalRoute({
        pathname: "/ai-governance",
        search: "",
        hash: "",
      }).workspace,
    ).toBe("ai-governance");
  });

  it("bounds exponential proof polling and stops after timeout", () => {
    const started = 1_000;
    expect(ledgerPollInterval(true, true, started, 0, 2_000)).toBe(1_000);
    expect(ledgerPollInterval(true, true, started, 3, 2_000)).toBe(8_000);
    expect(ledgerPollInterval(false, true, started, 0, 2_000)).toBe(false);
    expect(ledgerPollInterval(true, false, started, 0, 2_000)).toBe(false);
    expect(ledgerPollInterval(true, true, started, 0, 121_000)).toBe(false);
  });
});

describe("shared operational UI", () => {
  it.each([
    ["SUCCEEDED", "success"],
    ["RUNNING", "warning"],
    ["INVALID_OUTPUT", "danger"],
    ["CANCELLED", "cancelled"],
    ["SUPERSEDED", "superseded"],
    ["DISABLED", "disabled"],
    ["DRAFT", "info"],
    ["NORMAL", "success"],
    ["HIGH", "warning"],
    ["URGENT", "danger"],
    ["DECIDED", "success"],
    ["DECISION_PENDING", "warning"],
    ["CUSTOM_STATE", "neutral"],
  ] as const)("maps %s to the %s semantic tone", (value, tone) => {
    expect(statusPresentation(value)).toMatchObject({ tone });
  });

  it("renders consistent status, select, and full-value copy controls", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onChange = vi.fn();
    render(
      <main>
        <h1>Shared controls</h1>
        <StatusBadge value="INVALID_OUTPUT" />
        <SelectField label="Proof status" value="" onChange={onChange}>
          <option value="">All statuses</option>
          <option value="CONFIRMED">Confirmed</option>
        </SelectField>
        <CopyIdentifier value="complete-governed-identifier" />
      </main>,
    );
    expect(screen.getByText("INVALID OUTPUT")).toHaveClass("status-danger");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Proof status" }),
      "CONFIRMED",
    );
    expect(onChange).toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Copy full identifier complete-governed-identifier",
      }),
    );
    expect(writeText).toHaveBeenCalledWith("complete-governed-identifier");
  });

  it("traps focus in the emergency confirmation and restores it on Escape", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Emergency control";
    document.body.append(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const view = render(
      <ConfirmationDialog
        open
        title="Pause processing?"
        description="This blocks new assessment work."
        confirmLabel="Enable pause"
        busy={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = view.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleDescription(
      "This blocks new assessment work.",
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    view.rerender(
      <ConfirmationDialog
        open={false}
        title="Pause processing?"
        description="This blocks new assessment work."
        confirmLabel="Enable pause"
        busy={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("maps case lifecycle states to the cockpit stepper", () => {
    expect(caseLifecycleStage("DRAFT")).toBe(1);
    expect(caseLifecycleStage("EVIDENCE_COLLECTION")).toBe(2);
    expect(caseLifecycleStage("UNDER_REVIEW")).toBe(3);
    expect(caseLifecycleStage("DECIDED")).toBe(4);
    expect(caseStagePresentation("EVIDENCE_COLLECTION")).toEqual({
      stage: "Validate",
      description: "Evidence & controls",
    });
    expect(caseStagePresentation("UNDER_REVIEW")).toEqual({
      stage: "Review",
      description: "Risk & readiness",
    });
    expect(caseStagePresentation("DECISION_PENDING")).toEqual({
      stage: "Recommend",
      description: "Decision preparation",
    });
    expect(caseStagePresentation("DECIDED")).toEqual({
      stage: "Decide",
      description: "Final decision",
    });
  });
});
