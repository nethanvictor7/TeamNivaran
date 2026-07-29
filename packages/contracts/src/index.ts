import { z } from "zod";

export const correlationIdHeader = "x-correlation-id";

export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  eventVersion: z.string().regex(/^\d+\.\d+$/),
  occurredAt: z.iso.datetime(),
  correlationId: z.uuid(),
  causationId: z.uuid().nullable(),
  producer: z.string().min(1),
  organizationId: z.uuid().nullable(),
  actor: z.object({
    type: z.enum(["USER", "SERVICE", "SYSTEM"]),
    id: z.string().min(1),
  }),
  aggregate: z.object({
    type: z.string().min(1),
    id: z.string().min(1),
    version: z.number().int().nonnegative(),
  }),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const sourceAwareCanonicalEventSchema = eventEnvelopeSchema.extend({
  source: z.object({
    sourceSystemId: z.uuid(),
    connectorId: z.uuid(),
    sourceEventId: z.string().min(1).max(300),
    sourceEventType: z.string().max(160).nullable(),
    rawSourceEventId: z.uuid(),
    receivedAt: z.iso.datetime(),
  }),
  mapping: z.object({
    mappingVersionId: z.uuid(),
    correlationRuleVersionId: z.uuid().nullable(),
  }),
  caseId: z.uuid().nullable(),
});
export type SourceAwareCanonicalEvent = z.infer<
  typeof sourceAwareCanonicalEventSchema
>;

export const canonicalSourceEventTypes = [
  "case.source-linked",
  "party.received",
  "evidence.received",
  "case.attribute.changed",
  "decision.signal.received",
] as const;

export const evidenceReferenceProjectionSchema = z.object({
  classificationCode: z.enum([
    "IDENTITY",
    "INCOME",
    "BANK_STATEMENT",
    "CREDIT_REPORT",
    "APPLICATION_FORM",
    "COLLATERAL",
    "CORRESPONDENCE",
    "DECISION_RECORD",
    "OTHER",
  ]),
  title: z.string().trim().min(1).max(240),
  externalReference: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2000).optional(),
});
export type EvidenceReferenceProjection = z.infer<
  typeof evidenceReferenceProjectionSchema
>;

export const canonicalTriggerEventSchema = z.object({
  eventId: z.uuid(),
  eventType: z.literal("source.trigger.received"),
  eventVersion: z.literal("1.0"),
  occurredAt: z.iso.datetime(),
  organizationId: z.uuid().optional(),
  source: z.object({
    systemId: z.uuid(),
    connectorId: z.uuid(),
    connectorType: z.enum(["WEBHOOK", "SQL_POLL"]),
    triggerType: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/),
    sourceRecordId: z.string().optional(),
  }),
  journey: z.object({
    caseId: z.uuid().optional(),
    businessReference: z.string().optional(),
    correlationId: z.uuid(),
    causationId: z.uuid().optional(),
  }),
  subject: z.object({ type: z.string().optional(), id: z.string().optional() }),
  data: z.object({
    extractedFields: z.record(z.string(), z.unknown()),
    evidenceReference: evidenceReferenceProjectionSchema.optional(),
  }),
  rawPayloadReference: z.uuid(),
});
export type CanonicalTriggerEvent = z.infer<typeof canonicalTriggerEventSchema>;

export const loginRequestSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(12).max(256),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(32).optional(),
});

export const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  org_id: z.uuid(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  session_id: z.uuid(),
  token_type: z.literal("access"),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  jti: z.uuid(),
  iat: z.number(),
  exp: z.number(),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export const caseStatusSchema = z.enum([
  "DRAFT",
  "OPEN",
  "EVIDENCE_COLLECTION",
  "UNDER_REVIEW",
  "DECISION_PENDING",
  "DECIDED",
  "CLOSED",
  "CANCELLED",
]);
export const casePrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const casePartyTypeSchema = z.enum([
  "BORROWER",
  "GUARANTOR",
  "DIRECTOR",
  "OTHER",
]);
export const caseAssignmentRoleSchema = z.enum([
  "OWNER",
  "ANALYST",
  "REVIEWER",
  "OBSERVER",
]);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const createCaseRequestSchema = z
  .object({
    externalReference: z.string().trim().min(1).max(120).optional(),
    caseType: z.string().trim().min(1).max(80),
    title: z.string().trim().min(3).max(240),
    priority: casePrioritySchema.default("NORMAL"),
    requestedAmountMinor: z.number().int().nonnegative().optional(),
    currency: currencySchema.optional(),
    decisionDueAt: z.iso.datetime().optional(),
  })
  .refine(
    (value) =>
      (value.requestedAmountMinor === undefined) ===
      (value.currency === undefined),
    { message: "Amount and currency must be supplied together." },
  );

export const updateCaseRequestSchema = z.object({
  version: z.number().int().positive(),
  externalReference: z.string().trim().min(1).max(120).nullable().optional(),
  caseType: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(3).max(240).optional(),
  priority: casePrioritySchema.optional(),
  requestedAmountMinor: z.number().int().nonnegative().nullable().optional(),
  currency: currencySchema.nullable().optional(),
  decisionDueAt: z.iso.datetime().nullable().optional(),
  status: z.enum(["DRAFT", "OPEN"]).optional(),
});

export const createCasePartyRequestSchema = z.object({
  partyType: casePartyTypeSchema,
  displayName: z.string().trim().min(1).max(240),
  externalReference: z.string().trim().min(1).max(120).optional(),
});

export const createCaseAssignmentRequestSchema = z.object({
  userId: z.uuid(),
  role: caseAssignmentRoleSchema,
});

export const cancelCaseRequestSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});

export const casePartySchema = z.object({
  id: z.uuid(),
  partyType: casePartyTypeSchema,
  displayName: z.string(),
  externalReference: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const caseAssignmentSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  role: caseAssignmentRoleSchema,
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export const caseTimelineEntrySchema = z.object({
  id: z.uuid(),
  fromStatus: caseStatusSchema.nullable(),
  toStatus: caseStatusSchema,
  reason: z.string().nullable(),
  changedBy: z.uuid(),
  changedAt: z.iso.datetime(),
  version: z.number().int().positive(),
});
export const decisionCaseSchema = z.object({
  id: z.uuid(),
  caseNumber: z.string(),
  externalReference: z.string().nullable(),
  caseType: z.string(),
  title: z.string(),
  status: caseStatusSchema,
  priority: casePrioritySchema,
  requestedAmountMinor: z.number().int().nullable(),
  currency: currencySchema.nullable(),
  openedAt: z.iso.datetime().nullable(),
  decisionDueAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  createdBy: z.uuid(),
  updatedBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  parties: z.array(casePartySchema).optional(),
  assignments: z.array(caseAssignmentSchema).optional(),
});
export const caseListResponseSchema = z.object({
  items: z.array(decisionCaseSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type CaseStatus = z.infer<typeof caseStatusSchema>;
export type CasePriority = z.infer<typeof casePrioritySchema>;
export type CreateCaseRequest = z.infer<typeof createCaseRequestSchema>;
export type UpdateCaseRequest = z.infer<typeof updateCaseRequestSchema>;
export type DecisionCase = z.infer<typeof decisionCaseSchema>;
export type CaseListResponse = z.infer<typeof caseListResponseSchema>;

export const workflowStateSchema = z.enum([
  "NOT_STARTED",
  "VALIDATING",
  "EVIDENCE_REQUIRED",
  "READY_FOR_REVIEW",
  "UNDER_REVIEW",
  "CORRECTION_REQUESTED",
  "READY_FOR_RECOMMENDATION",
  "RECOMMENDATION_SUBMITTED",
  "DECISION_PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "CANCELLED",
]);
export const workflowTaskStatusSchema = z.enum([
  "PENDING",
  "CLAIMED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);
export const workflowValidationStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "WARNING",
  "NOT_APPLICABLE",
  "ERROR",
]);
export const workflowRecommendationOutcomeSchema = z.enum([
  "RECOMMEND_APPROVAL",
  "RECOMMEND_REJECTION",
  "REQUEST_MORE_INFORMATION",
]);
export const workflowDecisionOutcomeSchema = z.enum(["APPROVED", "REJECTED"]);
export const workflowEventSchema = eventEnvelopeSchema.extend({
  producer: z.literal("validation-workflow-service"),
  aggregate: z.object({
    type: z.enum(["WorkflowInstance", "WorkflowDefinition"]),
    id: z.uuid(),
    version: z.number().int().positive(),
  }),
});
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type WorkflowEvent = z.infer<typeof workflowEventSchema>;

export const caseProofTypeSchema = z.enum(["EVIDENCE", "DECISION"]);
export const caseProofLifecycleSchema = z.enum([
  "PENDING",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
]);
export const caseLedgerStateSchema = z.enum([
  "NOT_ELIGIBLE",
  "NOT_YET_ANCHORED",
  "ANCHORING",
  "PARTIALLY_ANCHORED",
  "ANCHORED",
  "VERIFICATION_ISSUE",
  "LEDGER_UNAVAILABLE",
]);
export const proofEligibilitySchema = z.enum([
  "NOT_ELIGIBLE",
  "ELIGIBLE_NOT_ANCHORED",
  "ANCHOR_REQUESTED",
]);
export const proofMatchStatusSchema = z.enum([
  "NOT_RUN",
  "MATCH",
  "MISMATCH",
  "UNAVAILABLE",
]);
export const proofConfirmationStatusSchema = z.enum([
  "NOT_SUBMITTED",
  "PENDING",
  "CONFIRMED",
  "NOT_FOUND",
  "UNAVAILABLE",
]);
export const caseProofListQuerySchema = z
  .object({
    proofType: caseProofTypeSchema.optional(),
    status: caseProofLifecycleSchema.optional(),
    evidenceId: z.uuid().optional(),
    evidenceVersionId: z.uuid().optional(),
    providerType: z
      .string()
      .regex(/^[A-Z][A-Z0-9_-]{1,29}$/)
      .optional(),
    cursor: z.string().min(1).max(2048).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export const caseProofVerificationSchema = z.object({
  offLedgerHash: proofMatchStatusSchema,
  ledgerConfirmation: proofConfirmationStatusSchema,
  ledgerHash: proofMatchStatusSchema,
  overallVerified: z.boolean(),
  providerState: z.string().nullable(),
  safeErrorCode: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  requestedBy: z.uuid().nullable(),
});
export const caseProofProviderBindingSchema = z.object({
  providerType: z.string(),
  transactionId: z.string().nullable(),
  proofReference: z.string().nullable(),
  contractReference: z.string().nullable(),
  networkReference: z.string().nullable(),
});
export const caseProofHistoryEventSchema = z.object({
  id: z.uuid(),
  eventType: z.string(),
  status: z.string(),
  occurredAt: z.iso.datetime(),
  actorId: z.string(),
});
export const caseProofSchema = z.object({
  proofRequestId: z.uuid(),
  proofId: z.uuid(),
  proofType: caseProofTypeSchema,
  eligibility: proofEligibilitySchema,
  lifecycle: caseProofLifecycleSchema,
  storedState: z.string(),
  retryable: z.boolean(),
  attemptCount: z.number().int().nonnegative(),
  safeFailureCode: z.string().nullable(),
  evidenceId: z.uuid().nullable(),
  evidenceVersionId: z.uuid().nullable(),
  decisionId: z.uuid().nullable(),
  decisionOutcome: z.string().nullable(),
  previousProofId: z.uuid().nullable(),
  provider: caseProofProviderBindingSchema,
  verification: caseProofVerificationSchema,
  requestedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
  finalizedAt: z.iso.datetime().nullable(),
  requestedBy: z.uuid(),
  history: z.array(caseProofHistoryEventSchema),
});
export const caseProofListResponseSchema = z.object({
  items: z.array(caseProofSchema),
  nextCursor: z.string().nullable(),
  pageSize: z.number().int().min(1).max(50),
});
export const evidenceProofTargetSchema = z.object({
  evidenceId: z.uuid(),
  evidenceVersionId: z.uuid(),
  classificationCode: z.string(),
  eligibility: proofEligibilitySchema,
  lifecycle: caseProofLifecycleSchema.nullable(),
  proofRequestId: z.uuid().nullable(),
  requestedAt: z.iso.datetime().nullable(),
});
export const decisionProofEligibilitySchema = z.object({
  eligibility: proofEligibilitySchema,
  reasonCode: z.string().nullable(),
  explanation: z.string(),
  decisionId: z.uuid().nullable(),
  decisionOutcome: z.string().nullable(),
  lifecycle: caseProofLifecycleSchema.nullable(),
  proofRequestId: z.uuid().nullable(),
});
export const caseLedgerSummarySchema = z.object({
  caseId: z.uuid(),
  state: caseLedgerStateSchema,
  ledgerAvailability: z.object({
    available: z.boolean(),
    providerType: z.string(),
    status: z.string(),
    checkedAt: z.iso.datetime(),
    safeErrorCode: z.string().nullable(),
  }),
  decision: decisionProofEligibilitySchema,
  evidenceCounts: z.object({
    eligible: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    submitted: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    notAnchored: z.number().int().nonnegative(),
  }),
  evidenceTargets: z.array(evidenceProofTargetSchema),
  latestVerification: caseProofVerificationSchema.nullable(),
  latestConfirmed: caseProofSchema.nullable(),
  freshness: z.object({
    generatedAt: z.iso.datetime(),
    evidenceSnapshotAt: z.iso.datetime(),
    staleAfter: z.iso.datetime(),
  }),
});
export const ledgerTransactionSchema = z.object({
  proofRequestId: z.uuid(),
  providerType: z.string(),
  state: z.string(),
  providerTransactionId: z.string(),
});
export type CaseProofListQuery = z.infer<typeof caseProofListQuerySchema>;
export type CaseProof = z.infer<typeof caseProofSchema>;
export type CaseProofListResponse = z.infer<typeof caseProofListResponseSchema>;
export type CaseLedgerSummary = z.infer<typeof caseLedgerSummarySchema>;
export type LedgerTransaction = z.infer<typeof ledgerTransactionSchema>;

export const createCaseExternalReferenceRequestSchema = z.object({
  sourceSystemId: z.uuid(),
  referenceType: z.string().trim().min(1).max(80),
  referenceValue: z.string().trim().min(1).max(240),
  isPrimary: z.boolean().default(false),
});
export const resolveCaseExternalReferenceRequestSchema = z.object({
  organizationId: z.uuid(),
  sourceSystemId: z.uuid(),
  referenceType: z.string().trim().min(1).max(80),
  referenceValue: z.string().trim().min(1).max(240),
});
export const caseExternalReferenceSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  sourceSystemId: z.uuid(),
  referenceType: z.string(),
  referenceValue: z.string(),
  isPrimary: z.boolean(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const auditOutcomeSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "DENIED",
  "PENDING",
  "INFORMATIONAL",
]);
export const auditRecordSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  organizationId: z.uuid(),
  occurredAt: z.iso.datetime(),
  ingestedAt: z.iso.datetime(),
  sourceService: z.string(),
  eventType: z.string(),
  schemaVersion: z.string(),
  actorType: z.string(),
  actorId: z.string(),
  correlationId: z.uuid(),
  causationId: z.uuid().nullable(),
  traceId: z.string().nullable(),
  requestId: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  resourceType: z.string(),
  resourceId: z.string(),
  action: z.string(),
  outcome: auditOutcomeSchema,
  classification: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  previousRecordHash: z.string().length(64).nullable(),
  recordHash: z.string().length(64),
  sourceTopic: z.string(),
  sourcePartition: z.number().int().nonnegative(),
  sourceOffset: z.string().regex(/^\d+$/),
  projectionVersion: z.number().int().positive(),
  lateArrival: z.boolean(),
});
export const auditSearchQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    eventType: z.string().trim().max(160).optional(),
    sourceService: z.string().trim().max(120).optional(),
    outcome: auditOutcomeSchema.optional(),
    classification: z.string().trim().max(40).optional(),
    resourceType: z.string().trim().max(100).optional(),
    resourceId: z.string().trim().max(160).optional(),
    correlationId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    sort: z.enum(["OCCURRED_DESC", "OCCURRED_ASC"]).default("OCCURRED_DESC"),
    cursor: z.string().min(20).max(4096).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const auditSearchResponseSchema = z.object({
  items: z.array(auditRecordSchema),
  nextCursor: z.string().nullable(),
  snapshotBoundary: z.iso.datetime(),
  freshness: z.object({
    status: z.string(),
    projectionVersion: z.number().int().positive(),
    lastIngestedAt: z.iso.datetime().nullable(),
    checkpoints: z.array(
      z.object({
        id: z.uuid(),
        topic: z.string(),
        partition: z.number().int().nonnegative(),
        offset: z.string().regex(/^\d+$/),
        lastEventId: z.uuid().nullable(),
        updatedAt: z.iso.datetime(),
      }),
    ),
  }),
});
export const auditReportRequestSchema = z
  .object({
    reportKey: z.enum([
      "CASE_DECISION_DOSSIER",
      "EVIDENCE_VALIDATION_HISTORY",
      "HUMAN_DECISION_SUMMARY",
      "LEDGER_VERIFICATION_HISTORY",
      "OPERATIONAL_AUDIT_ACTIVITY",
      "AI_ASSESSMENT_GOVERNANCE",
    ]),
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const auditExportRequestSchema = z
  .object({
    format: z.enum(["CSV", "JSON"]),
    filters: auditSearchQuerySchema
      .omit({ cursor: true, pageSize: true })
      .default({ sort: "OCCURRED_DESC" }),
  })
  .strict();
export const auditOperationRequestSchema = z
  .object({
    type: z.enum(["REPLAY", "PROJECTION_REBUILD", "RECONCILIATION"]),
    reason: z.string().trim().min(10).max(500),
    dryRun: z.boolean().default(true),
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const auditArtifactGrantSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;
export type AuditRecord = z.infer<typeof auditRecordSchema>;
export type AuditSearchQuery = z.infer<typeof auditSearchQuerySchema>;
export type AuditSearchResponse = z.infer<typeof auditSearchResponseSchema>;
export type AuditReportRequest = z.infer<typeof auditReportRequestSchema>;
export type AuditExportRequest = z.infer<typeof auditExportRequestSchema>;
export type AuditOperationRequest = z.infer<typeof auditOperationRequestSchema>;
