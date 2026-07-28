-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DefinitionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('NOT_STARTED', 'VALIDATING', 'EVIDENCE_REQUIRED', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'CORRECTION_REQUESTED', 'READY_FOR_RECOMMENDATION', 'RECOMMENDATION_SUBMITTED', 'DECISION_PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('PASS', 'FAIL', 'WARNING', 'NOT_APPLICABLE', 'ERROR');

-- CreateEnum
CREATE TYPE "RecommendationOutcome" AS ENUM ('RECOMMEND_APPROVAL', 'RECOMMEND_REJECTION', 'REQUEST_MORE_INFORMATION');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CaseSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "status" "DefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definition_versions" (
    "id" UUID NOT NULL,
    "workflow_definition_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "DefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "start_mode" VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
    "warning_policy" VARCHAR(40) NOT NULL DEFAULT 'NON_BLOCKING',
    "four_eyes_enabled" BOOLEAN NOT NULL DEFAULT true,
    "prohibit_evidence_submitter_approval" BOOLEAN NOT NULL DEFAULT false,
    "prohibit_reviewer_approval" BOOLEAN NOT NULL DEFAULT false,
    "default_review_due_hours" INTEGER NOT NULL DEFAULT 24,
    "default_decision_due_hours" INTEGER NOT NULL DEFAULT 24,
    "configuration_json" JSONB NOT NULL,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ,
    "retired_by" UUID,
    "retired_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_definition_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "case_number_snapshot" VARCHAR(40) NOT NULL,
    "workflow_definition_id" UUID NOT NULL,
    "workflow_definition_version_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "state" "WorkflowState" NOT NULL DEFAULT 'NOT_STARTED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "active_task_id" UUID,
    "current_validation_run_id" UUID,
    "current_recommendation_id" UUID,
    "current_decision_id" UUID,
    "case_sync_status" "CaseSyncStatus" NOT NULL DEFAULT 'PENDING',
    "started_by_type" VARCHAR(20) NOT NULL DEFAULT 'USER',
    "started_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_state_history" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "from_state" "WorkflowState",
    "to_state" "WorkflowState" NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "reason_code" VARCHAR(80),
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "correlation_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_state_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "run_number" INTEGER NOT NULL,
    "trigger_type" VARCHAR(40) NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "definition_version_id" UUID NOT NULL,
    "case_snapshot_json" JSONB NOT NULL,
    "evidence_snapshot_json" JSONB NOT NULL,
    "started_by_type" VARCHAR(20) NOT NULL,
    "started_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "error_code" VARCHAR(80),
    "error_detail_sanitized" VARCHAR(500),

    CONSTRAINT "validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_results" (
    "id" UUID NOT NULL,
    "validation_run_id" UUID NOT NULL,
    "rule_definition_id" VARCHAR(80) NOT NULL,
    "rule_version" INTEGER NOT NULL DEFAULT 1,
    "rule_type" VARCHAR(80) NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "message_code" VARCHAR(100) NOT NULL,
    "safe_parameters_json" JSONB NOT NULL,
    "input_references_json" JSONB NOT NULL,
    "evaluated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "task_type" VARCHAR(60) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "required_permission" VARCHAR(120) NOT NULL,
    "eligible_role_codes_json" JSONB NOT NULL,
    "assigned_user_id" UUID,
    "claimed_by" UUID,
    "claimed_at" TIMESTAMPTZ,
    "due_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignment_history" (
    "id" UUID NOT NULL,
    "workflow_task_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "actor_id" UUID NOT NULL,
    "from_user_id" UUID,
    "to_user_id" UUID,
    "task_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_submissions" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "validation_run_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "outcome" VARCHAR(60) NOT NULL,
    "reason_codes_json" JSONB NOT NULL,
    "rationale" VARCHAR(4000) NOT NULL,
    "evidence_snapshot_json" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggregate_version" INTEGER NOT NULL,

    CONSTRAINT "review_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_submission_evidence" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "review_submission_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "classification_code" VARCHAR(100) NOT NULL,
    "evidence_status" VARCHAR(40) NOT NULL,
    "available_at" TIMESTAMPTZ NOT NULL,
    "snapshot_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_submission_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_requests" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "target_type" VARCHAR(60) NOT NULL,
    "target_id" UUID,
    "reason_code" VARCHAR(80) NOT NULL,
    "rationale" VARCHAR(4000) NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_recommendations" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "validation_run_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "outcome" "RecommendationOutcome" NOT NULL,
    "reason_codes_json" JSONB NOT NULL,
    "rationale" VARCHAR(4000) NOT NULL,
    "conditions" JSONB NOT NULL,
    "evidence_snapshot_json" JSONB NOT NULL,
    "supporting_assessment_ids_json" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggregate_version" INTEGER NOT NULL,

    CONSTRAINT "decision_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_recommendation_evidence" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "decision_recommendation_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "classification_code" VARCHAR(100) NOT NULL,
    "evidence_status" VARCHAR(40) NOT NULL,
    "available_at" TIMESTAMPTZ NOT NULL,
    "snapshot_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_recommendation_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "reason_codes_json" JSONB NOT NULL,
    "rationale" VARCHAR(4000) NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "definition_version_snapshot_json" JSONB NOT NULL,
    "validation_run_id" UUID NOT NULL,
    "evidence_snapshot_json" JSONB NOT NULL,
    "supersedes_decision_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_evidence_snapshots" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "decision_record_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "classification_code" VARCHAR(100) NOT NULL,
    "evidence_status" VARCHAR(40) NOT NULL,
    "available_at" TIMESTAMPTZ NOT NULL,
    "snapshot_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_evidence_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_action_actors" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "actor_id" UUID NOT NULL,
    "reference_id" UUID,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_action_actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "task_id" UUID,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "route" VARCHAR(160) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_events" (
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "event_version" VARCHAR(20) NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "organization_id" UUID NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_sync_operations" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "target_status" VARCHAR(40) NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "status" "CaseSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,
    "last_error_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "case_sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_timers" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "timer_type" VARCHAR(60) NOT NULL,
    "due_at" TIMESTAMPTZ NOT NULL,
    "fired_at" TIMESTAMPTZ,
    "lease_owner" VARCHAR(120),
    "lease_expires_at" TIMESTAMPTZ,

    CONSTRAINT "workflow_timers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_definitions_organization_id_status_is_default_idx" ON "workflow_definitions"("organization_id", "status", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_organization_id_code_key" ON "workflow_definitions"("organization_id", "code");

-- CreateIndex
CREATE INDEX "workflow_definition_versions_status_published_at_idx" ON "workflow_definition_versions"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definition_versions_workflow_definition_id_version_key" ON "workflow_definition_versions"("workflow_definition_id", "version_number");

-- CreateIndex
CREATE INDEX "workflow_instances_organization_id_case_id_active_idx" ON "workflow_instances"("organization_id", "case_id", "active");

-- CreateIndex
CREATE INDEX "workflow_instances_organization_id_state_updated_at_idx" ON "workflow_instances"("organization_id", "state", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_organization_id_case_id_cycle_number_key" ON "workflow_instances"("organization_id", "case_id", "cycle_number");

-- CreateIndex
CREATE INDEX "workflow_state_history_workflow_instance_id_occurred_at_idx" ON "workflow_state_history"("workflow_instance_id", "occurred_at");

-- CreateIndex
CREATE INDEX "validation_runs_organization_id_completed_at_idx" ON "validation_runs"("organization_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "validation_runs_workflow_instance_id_run_number_key" ON "validation_runs"("workflow_instance_id", "run_number");

-- CreateIndex
CREATE INDEX "validation_results_validation_run_id_status_idx" ON "validation_results"("validation_run_id", "status");

-- CreateIndex
CREATE INDEX "workflow_tasks_organization_id_status_due_at_idx" ON "workflow_tasks"("organization_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "workflow_tasks_organization_id_assigned_user_id_status_idx" ON "workflow_tasks"("organization_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "task_assignment_history_workflow_task_id_occurred_at_idx" ON "task_assignment_history"("workflow_task_id", "occurred_at");

-- CreateIndex
CREATE INDEX "review_submissions_workflow_instance_id_submitted_at_idx" ON "review_submissions"("workflow_instance_id", "submitted_at");

-- CreateIndex
CREATE INDEX "review_submission_evidence_workflow_instance_id_snapshot_at_idx" ON "review_submission_evidence"("workflow_instance_id", "snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_submission_evidence_review_submission_id_evidence_ve_key" ON "review_submission_evidence"("review_submission_id", "evidence_version_id");

-- CreateIndex
CREATE INDEX "decision_recommendations_workflow_instance_id_submitted_at_idx" ON "decision_recommendations"("workflow_instance_id", "submitted_at");

-- CreateIndex
CREATE INDEX "decision_recommendation_evidence_workflow_instance_id_snaps_idx" ON "decision_recommendation_evidence"("workflow_instance_id", "snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "decision_recommendation_evidence_decision_recommendation_id_key" ON "decision_recommendation_evidence"("decision_recommendation_id", "evidence_version_id");

-- CreateIndex
CREATE INDEX "decision_records_organization_id_case_id_decided_at_idx" ON "decision_records"("organization_id", "case_id", "decided_at");

-- CreateIndex
CREATE UNIQUE INDEX "decision_records_workflow_instance_id_key" ON "decision_records"("workflow_instance_id");

-- CreateIndex
CREATE INDEX "decision_evidence_snapshots_workflow_instance_id_snapshot_a_idx" ON "decision_evidence_snapshots"("workflow_instance_id", "snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "decision_evidence_snapshots_decision_record_id_evidence_ver_key" ON "decision_evidence_snapshots"("decision_record_id", "evidence_version_id");

-- CreateIndex
CREATE INDEX "workflow_action_actors_workflow_instance_id_action_actor_id_idx" ON "workflow_action_actors"("workflow_instance_id", "action", "actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organization_id_actor_id_route_key_key" ON "idempotency_records"("organization_id", "actor_id", "route", "key");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_next_attempt_at_occurred_at_idx" ON "outbox_events"("published_at", "next_attempt_at", "occurred_at");

-- CreateIndex
CREATE INDEX "case_sync_operations_status_next_attempt_at_idx" ON "case_sync_operations"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "case_sync_operations_workflow_instance_id_event_type_key" ON "case_sync_operations"("workflow_instance_id", "event_type");

-- CreateIndex
CREATE INDEX "workflow_timers_fired_at_due_at_idx" ON "workflow_timers"("fired_at", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_timers_task_id_timer_type_key" ON "workflow_timers"("task_id", "timer_type");

-- AddForeignKey
ALTER TABLE "workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_definition_version_id_fkey" FOREIGN KEY ("workflow_definition_version_id") REFERENCES "workflow_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_state_history" ADD CONSTRAINT "workflow_state_history_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_validation_run_id_fkey" FOREIGN KEY ("validation_run_id") REFERENCES "validation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment_history" ADD CONSTRAINT "task_assignment_history_workflow_task_id_fkey" FOREIGN KEY ("workflow_task_id") REFERENCES "workflow_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_submissions" ADD CONSTRAINT "review_submissions_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_submission_evidence" ADD CONSTRAINT "review_submission_evidence_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_submission_evidence" ADD CONSTRAINT "review_submission_evidence_review_submission_id_fkey" FOREIGN KEY ("review_submission_id") REFERENCES "review_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendation_evidence" ADD CONSTRAINT "decision_recommendation_evidence_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendation_evidence" ADD CONSTRAINT "decision_recommendation_evidence_decision_recommendation_i_fkey" FOREIGN KEY ("decision_recommendation_id") REFERENCES "decision_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "decision_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_evidence_snapshots" ADD CONSTRAINT "decision_evidence_snapshots_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_evidence_snapshots" ADD CONSTRAINT "decision_evidence_snapshots_decision_record_id_fkey" FOREIGN KEY ("decision_record_id") REFERENCES "decision_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_action_actors" ADD CONSTRAINT "workflow_action_actors_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce one active governed cycle per organization and Case.
CREATE UNIQUE INDEX "workflow_instances_one_active_case_idx"
ON "workflow_instances" ("organization_id", "case_id")
WHERE "active" = true;

-- A deterministic platform default makes a clean local deployment immediately
-- usable while remaining pinned and immutable for every started instance.
INSERT INTO "workflow_definitions" (
  "id", "organization_id", "code", "name", "description", "status",
  "is_default", "created_by", "updated_by", "updated_at"
) VALUES (
  '00000000-0000-4000-8000-000000000401',
  NULL,
  'PLATFORM-DEFAULT',
  'Platform default validation and approval',
  'Deterministic Phase 4 default for commercial credit cases.',
  'PUBLISHED',
  true,
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP
);

INSERT INTO "workflow_definition_versions" (
  "id", "workflow_definition_id", "version_number", "status", "start_mode",
  "warning_policy", "four_eyes_enabled",
  "prohibit_evidence_submitter_approval", "prohibit_reviewer_approval",
  "default_review_due_hours", "default_decision_due_hours",
  "configuration_json", "published_by", "published_at", "created_by"
) VALUES (
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000401',
  1,
  'PUBLISHED',
  'MANUAL',
  'NON_BLOCKING',
  true,
  false,
  false,
  24,
  24,
  '{
    "caseTypes": ["COMMERCIAL_CREDIT"],
    "requiredEvidence": [
      {
        "classificationCode": "APPLICATION_FORM",
        "minimumCount": 1,
        "currentOnly": true
      }
    ],
    "rules": [
      {
        "id": "application-form-present",
        "type": "REQUIRED_EVIDENCE_PRESENT",
        "classificationCode": "APPLICATION_FORM"
      },
      {
        "id": "case-title-present",
        "type": "CASE_FIELD_PRESENT",
        "field": "title"
      }
    ],
    "reasonCodes": [
      "STANDARD_REVIEW",
      "INFORMATION_REQUIRED",
      "POLICY_REQUIREMENT"
    ],
    "reviewOutcomes": [
      "READY_FOR_RECOMMENDATION",
      "CORRECTION_REQUIRED"
    ]
  }'::jsonb,
  '00000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP,
  '00000000-0000-4000-8000-000000000001'
);
