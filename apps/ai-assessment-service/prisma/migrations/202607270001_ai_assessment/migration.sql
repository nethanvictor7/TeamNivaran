-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('QUEUED', 'PREPARING_INPUT', 'READY_FOR_INFERENCE', 'SUBMITTED', 'RUNNING', 'VALIDATING_OUTPUT', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'POLICY_BLOCKED', 'INVALID_OUTPUT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "GovernanceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateTable
CREATE TABLE "ai_runtime_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "mock_profile" VARCHAR(40) NOT NULL DEFAULT 'SUCCESS',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "max_input_bytes" INTEGER NOT NULL DEFAULT 1048576,
    "max_evidence_items" INTEGER NOT NULL DEFAULT 25,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "retry_limit" INTEGER NOT NULL DEFAULT 3,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_runtime_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "runtime_config_id" UUID NOT NULL,
    "prompt_template_version_id" UUID NOT NULL,
    "allowed_classifications_json" JSONB NOT NULL,
    "allowed_media_types_json" JSONB NOT NULL,
    "purpose" VARCHAR(240) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "model_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_template_versions" (
    "id" UUID NOT NULL,
    "prompt_template_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "GovernanceStatus" NOT NULL DEFAULT 'DRAFT',
    "system_prompt" TEXT NOT NULL,
    "output_schema_json" JSONB NOT NULL,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ,
    "retired_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redaction_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "patterns_json" JSONB NOT NULL,
    "replacement" VARCHAR(80) NOT NULL DEFAULT '[REDACTED]',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "redaction_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_kill_switches" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "scope" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_kill_switches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "workflow_version" INTEGER NOT NULL,
    "validation_run_id" UUID NOT NULL,
    "case_version" INTEGER NOT NULL,
    "model_policy_id" UUID NOT NULL,
    "runtime_config_id" UUID NOT NULL,
    "prompt_template_version_id" UUID NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'QUEUED',
    "purpose" VARCHAR(240) NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "superseded_at" TIMESTAMPTZ,
    "status_reason_code" VARCHAR(100),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "input_fingerprint" CHAR(64),

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_input_refs" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "classification_code" VARCHAR(100) NOT NULL,
    "media_type" VARCHAR(160),
    "size_bytes" BIGINT,
    "available_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assessment_input_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepared_inputs" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "case_snapshot_json" JSONB NOT NULL,
    "workflow_snapshot_json" JSONB NOT NULL,
    "content_records_json" JSONB NOT NULL,
    "excluded_records_json" JSONB NOT NULL,
    "byte_count" INTEGER NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "prepared_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prepared_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_executions" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "adapter_mode" VARCHAR(40) NOT NULL,
    "mock_profile" VARCHAR(40),
    "provider_execution_id" VARCHAR(160),
    "status" VARCHAR(40) NOT NULL,
    "submitted_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "latency_ms" INTEGER,
    "raw_output_encrypted" TEXT,
    "error_code" VARCHAR(100),

    CONSTRAINT "assessment_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_outputs" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "summary" VARCHAR(4000) NOT NULL,
    "recommendation" VARCHAR(80) NOT NULL,
    "confidence" INTEGER NOT NULL,
    "schema_version" VARCHAR(20) NOT NULL,
    "validated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_findings" (
    "id" UUID NOT NULL,
    "output_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" VARCHAR(2000) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,

    CONSTRAINT "assessment_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_missing_information" (
    "id" UUID NOT NULL,
    "output_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "label" VARCHAR(240) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "assessment_missing_information_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_risk_indicators" (
    "id" UUID NOT NULL,
    "output_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "label" VARCHAR(240) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,

    CONSTRAINT "assessment_risk_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_citations" (
    "id" UUID NOT NULL,
    "output_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "excerpt" VARCHAR(1000),

    CONSTRAINT "assessment_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_feedback" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "rating" VARCHAR(20) NOT NULL,
    "comment" VARCHAR(2000),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_acceptances" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "workflow_draft_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_acceptance_items" (
    "id" UUID NOT NULL,
    "acceptance_id" UUID NOT NULL,
    "item_type" VARCHAR(40) NOT NULL,
    "item_code" VARCHAR(80) NOT NULL,

    CONSTRAINT "assessment_acceptance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_usage" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "input_bytes" INTEGER NOT NULL,
    "evidence_item_count" INTEGER NOT NULL,
    "output_bytes" INTEGER NOT NULL,
    "adapter_mode" VARCHAR(40) NOT NULL,

    CONSTRAINT "assessment_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_job_leases" (
    "assessment_id" UUID NOT NULL,
    "owner" VARCHAR(120) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "next_attempt_at" TIMESTAMPTZ,

    CONSTRAINT "assessment_job_leases_pkey" PRIMARY KEY ("assessment_id")
);

-- CreateTable
CREATE TABLE "assessment_failures" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "retryable" BOOLEAN NOT NULL,
    "detail_sanitized" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_failures_pkey" PRIMARY KEY ("id")
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
    "organization_id" UUID NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_runtime_configs_organization_id_code_key" ON "ai_runtime_configs"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "model_policies_organization_id_code_key" ON "model_policies"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_organization_id_code_key" ON "prompt_templates"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_template_versions_prompt_template_id_version_number_key" ON "prompt_template_versions"("prompt_template_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "redaction_policies_organization_id_code_key" ON "redaction_policies"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ai_kill_switches_organization_id_scope_key" ON "ai_kill_switches"("organization_id", "scope");

-- CreateIndex
CREATE INDEX "assessments_organization_id_case_id_requested_at_idx" ON "assessments"("organization_id", "case_id", "requested_at");

-- CreateIndex
CREATE INDEX "assessments_status_requested_at_idx" ON "assessments"("status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_input_refs_assessment_id_evidence_version_id_key" ON "assessment_input_refs"("assessment_id", "evidence_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "prepared_inputs_assessment_id_key" ON "prepared_inputs"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_executions_assessment_id_attempt_number_key" ON "assessment_executions"("assessment_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_outputs_assessment_id_key" ON "assessment_outputs"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_findings_output_id_code_key" ON "assessment_findings"("output_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_missing_information_output_id_code_key" ON "assessment_missing_information"("output_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_risk_indicators_output_id_code_key" ON "assessment_risk_indicators"("output_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_citations_output_id_code_key" ON "assessment_citations"("output_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_acceptance_items_acceptance_id_item_type_item_co_key" ON "assessment_acceptance_items"("acceptance_id", "item_type", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_usage_assessment_id_key" ON "assessment_usage"("assessment_id");

-- CreateIndex
CREATE INDEX "assessment_job_leases_expires_at_next_attempt_at_idx" ON "assessment_job_leases"("expires_at", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organization_id_actor_id_route_key_key" ON "idempotency_records"("organization_id", "actor_id", "route", "key");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_next_attempt_at_occurred_at_idx" ON "outbox_events"("published_at", "next_attempt_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "prompt_template_versions" ADD CONSTRAINT "prompt_template_versions_prompt_template_id_fkey" FOREIGN KEY ("prompt_template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_input_refs" ADD CONSTRAINT "assessment_input_refs_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepared_inputs" ADD CONSTRAINT "prepared_inputs_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_executions" ADD CONSTRAINT "assessment_executions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_outputs" ADD CONSTRAINT "assessment_outputs_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_findings" ADD CONSTRAINT "assessment_findings_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "assessment_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_missing_information" ADD CONSTRAINT "assessment_missing_information_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "assessment_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_risk_indicators" ADD CONSTRAINT "assessment_risk_indicators_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "assessment_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_citations" ADD CONSTRAINT "assessment_citations_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "assessment_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_feedback" ADD CONSTRAINT "assessment_feedback_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_acceptances" ADD CONSTRAINT "assessment_acceptances_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_acceptance_items" ADD CONSTRAINT "assessment_acceptance_items_acceptance_id_fkey" FOREIGN KEY ("acceptance_id") REFERENCES "assessment_acceptances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_usage" ADD CONSTRAINT "assessment_usage_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_job_leases" ADD CONSTRAINT "assessment_job_leases_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_failures" ADD CONSTRAINT "assessment_failures_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed platform governance for deterministic local validation. These records
-- contain no provider endpoint, credential, or inferred live Cortex contract.
INSERT INTO "ai_runtime_configs" (
  "id", "organization_id", "code", "mock_profile", "enabled",
  "max_input_bytes", "max_evidence_items", "timeout_ms", "retry_limit",
  "created_by", "created_at", "updated_at"
) VALUES (
  '50000000-0000-4000-8000-000000000001', NULL, 'PLATFORM_MOCK_SUCCESS',
  'SUCCESS', true, 1048576, 25, 10000, 3,
  '00000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "prompt_templates" (
  "id", "organization_id", "code", "name", "created_by", "created_at"
) VALUES (
  '50000000-0000-4000-8000-000000000002', NULL, 'CONTROLLED_CASE_ASSESSMENT',
  'Controlled case assessment',
  '00000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP
);

INSERT INTO "prompt_template_versions" (
  "id", "prompt_template_id", "version_number", "status", "system_prompt",
  "output_schema_json", "published_by", "published_at", "created_by", "created_at"
) VALUES (
  '50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000002', 1, 'PUBLISHED',
  'Produce deterministic decision-support observations only. Never make a credit decision. Cite only pinned evidence versions and require human review.',
  '{"contract":"cdep.ai.assessment-output","version":"1.0"}'::jsonb,
  '00000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP,
  '00000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP
);

INSERT INTO "model_policies" (
  "id", "organization_id", "code", "enabled", "runtime_config_id",
  "prompt_template_version_id", "allowed_classifications_json",
  "allowed_media_types_json", "purpose", "created_by", "created_at", "updated_at"
) VALUES (
  '50000000-0000-4000-8000-000000000004', NULL, 'PLATFORM_REVIEW_SUPPORT',
  true, '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000003',
  '["IDENTITY","INCOME","BANK_STATEMENT","CREDIT_REPORT","APPLICATION_FORM","COLLATERAL","CORRESPONDENCE","OTHER"]'::jsonb,
  '["text/plain","application/pdf","image/png","image/jpeg"]'::jsonb,
  'Human review decision support using pinned authoritative records',
  '00000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "redaction_policies" (
  "id", "organization_id", "code", "enabled", "patterns_json",
  "replacement", "created_by", "created_at", "updated_at"
) VALUES (
  '50000000-0000-4000-8000-000000000005', NULL, 'PLATFORM_SAFE_LOGGING',
  true, '["authorization","cookie","rawOutput","body"]'::jsonb, '[REDACTED]',
  '00000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
