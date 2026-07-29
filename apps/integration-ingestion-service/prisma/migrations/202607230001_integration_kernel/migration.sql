-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('WEBHOOK', 'POSTGRES_POLL');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RawEventStatus" AS ENUM ('RECEIVED', 'UNRECOGNIZED', 'AMBIGUOUS_DEFINITION', 'SCHEMA_INVALID', 'MAPPING_PENDING', 'MAPPING_FAILED', 'CORRELATION_PENDING', 'UNMATCHED', 'AMBIGUOUS_CORRELATION', 'CANONICALIZED', 'PUBLISHED', 'FAILED', 'SOURCE_ID_PAYLOAD_CONFLICT');

-- CreateTable
CREATE TABLE "source_systems" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "status" "SourceStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "source_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_system_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'DRAFT',
    "configuration_json" JSONB NOT NULL,
    "credential_id" UUID,
    "poll_interval_seconds" INTEGER,
    "batch_size" INTEGER NOT NULL DEFAULT 100,
    "last_success_at" TIMESTAMPTZ,
    "last_error_code" VARCHAR(120),
    "next_run_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "connector_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_credentials" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "secret_ref" VARCHAR(500),
    "algorithm" VARCHAR(40),
    "key_id" VARCHAR(120),
    "nonce" BYTEA,
    "auth_tag" BYTEA,
    "ciphertext" BYTEA,
    "rotated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_schemas" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_system_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_json" JSONB NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_schemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_event_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_system_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "configuration_json" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "custom_event_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_mapping_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_definition_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_mapping_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_mapping_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "mapping_set_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration_json" JSONB NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "tested_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,

    CONSTRAINT "event_mapping_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mapping_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "mapping_version_id" UUID NOT NULL,
    "target_path" VARCHAR(300) NOT NULL,
    "rule_json" JSONB NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "field_mapping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_rule_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correlation_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_rule_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration_json" JSONB NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "tested_at" TIMESTAMPTZ,

    CONSTRAINT "correlation_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_checkpoints" (
    "connector_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "watermark_json" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "connector_checkpoints_pkey" PRIMARY KEY ("connector_id")
);

-- CreateTable
CREATE TABLE "connector_leases" (
    "connector_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "connector_leases_pkey" PRIMARY KEY ("connector_id")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "rows_captured" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "error_code" VARCHAR(120),

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_source_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_system_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "source_event_id" VARCHAR(300) NOT NULL,
    "source_event_type" VARCHAR(160),
    "occurred_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload_json" JSONB NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "source_metadata_json" JSONB NOT NULL,
    "status" "RawEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "processing_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_source_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raw_source_event_id" UUID NOT NULL,
    "canonical_event_type" VARCHAR(160) NOT NULL,
    "event_version" VARCHAR(20) NOT NULL,
    "case_id" UUID,
    "payload_json" JSONB NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_processing_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raw_source_event_id" UUID NOT NULL,
    "stage" VARCHAR(80) NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_processing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raw_source_event_id" UUID NOT NULL,
    "error_code" VARCHAR(120) NOT NULL,
    "sanitized_detail" VARCHAR(1000) NOT NULL,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "failed_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_correlations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raw_source_event_id" UUID NOT NULL,
    "case_id" UUID,
    "outcome" VARCHAR(40) NOT NULL,
    "rule_version_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_correlations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_journey_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID,
    "raw_source_event_id" UUID NOT NULL,
    "canonical_event_id" UUID,
    "event_type" VARCHAR(160) NOT NULL,
    "source_system_id" UUID NOT NULL,
    "source_event_id" VARCHAR(300) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL,
    "processing_status" VARCHAR(40) NOT NULL,
    "correlation_outcome" VARCHAR(40) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "summary_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_journey_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raw_source_event_id" UUID NOT NULL,
    "mapping_version_id" UUID,
    "requested_by" UUID NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "topic" VARCHAR(160) NOT NULL,
    "message_key" VARCHAR(300) NOT NULL,
    "event_json" JSONB NOT NULL,
    "correlation_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_events" (
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_systems_organization_id_code_key" ON "source_systems"("organization_id", "code");

-- CreateIndex
CREATE INDEX "connector_definitions_organization_id_source_system_id_idx" ON "connector_definitions"("organization_id", "source_system_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_schemas_source_system_id_name_version_key" ON "source_schemas"("source_system_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "custom_event_definitions_organization_id_source_system_id_c_key" ON "custom_event_definitions"("organization_id", "source_system_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "event_mapping_versions_mapping_set_id_version_key" ON "event_mapping_versions"("mapping_set_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "correlation_rule_versions_rule_set_id_version_key" ON "correlation_rule_versions"("rule_set_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "raw_source_events_organization_id_source_system_id_source_e_key" ON "raw_source_events"("organization_id", "source_system_id", "source_event_id");

-- CreateIndex
CREATE INDEX "decision_journey_events_organization_id_case_id_occurred_at_idx" ON "decision_journey_events"("organization_id", "case_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organization_id_key_key" ON "idempotency_records"("organization_id", "key");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_occurred_at_idx" ON "outbox_events"("published_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "connector_definitions" ADD CONSTRAINT "connector_definitions_source_system_id_fkey" FOREIGN KEY ("source_system_id") REFERENCES "source_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;
