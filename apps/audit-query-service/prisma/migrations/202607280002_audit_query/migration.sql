CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED', 'PENDING', 'INFORMATIONAL');
CREATE TYPE "JobState" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "audit_records" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_service" VARCHAR(120) NOT NULL,
  "event_type" VARCHAR(160) NOT NULL,
  "schema_version" VARCHAR(20) NOT NULL,
  "actor_type" VARCHAR(20) NOT NULL,
  "actor_id" VARCHAR(160) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "causation_id" UUID,
  "trace_id" VARCHAR(64),
  "request_id" VARCHAR(128),
  "idempotency_key" VARCHAR(200),
  "resource_type" VARCHAR(100) NOT NULL,
  "resource_id" VARCHAR(160) NOT NULL,
  "action" VARCHAR(160) NOT NULL,
  "outcome" "AuditOutcome" NOT NULL,
  "classification" VARCHAR(40) NOT NULL DEFAULT 'INTERNAL',
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  "previous_record_hash" CHAR(64),
  "record_hash" CHAR(64) NOT NULL,
  "source_topic" VARCHAR(200) NOT NULL,
  "source_partition" INTEGER NOT NULL,
  "source_offset" BIGINT NOT NULL,
  "projection_version" INTEGER NOT NULL DEFAULT 1,
  "late_arrival" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "audit_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audit_records_event_id_key" ON "audit_records"("event_id");
CREATE UNIQUE INDEX "audit_records_record_hash_key" ON "audit_records"("record_hash");
CREATE UNIQUE INDEX "audit_records_source_position_key" ON "audit_records"("source_topic", "source_partition", "source_offset");
CREATE INDEX "audit_records_org_time_idx" ON "audit_records"("organization_id", "occurred_at" DESC, "id" DESC);
CREATE INDEX "audit_records_resource_idx" ON "audit_records"("organization_id", "resource_type", "resource_id", "occurred_at");
CREATE INDEX "audit_records_correlation_idx" ON "audit_records"("organization_id", "correlation_id", "occurred_at");
CREATE INDEX "audit_records_event_type_idx" ON "audit_records"("organization_id", "event_type", "occurred_at");

CREATE TABLE "consumer_checkpoints" (
  "id" UUID NOT NULL,
  "topic" VARCHAR(200) NOT NULL,
  "partition" INTEGER NOT NULL,
  "offset" BIGINT NOT NULL,
  "last_event_id" UUID,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "consumer_checkpoints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "consumer_checkpoints_topic_partition_key" ON "consumer_checkpoints"("topic", "partition");

CREATE TABLE "quarantined_events" (
  "id" UUID NOT NULL,
  "topic" VARCHAR(200) NOT NULL,
  "partition" INTEGER NOT NULL,
  "offset" BIGINT NOT NULL,
  "payload_sha256" CHAR(64) NOT NULL,
  "safe_error_code" VARCHAR(100) NOT NULL,
  "quarantined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ,
  CONSTRAINT "quarantined_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quarantined_events_position_key" ON "quarantined_events"("topic", "partition", "offset");
CREATE INDEX "quarantined_events_resolution_idx" ON "quarantined_events"("resolved_at", "quarantined_at");

CREATE TABLE "report_runs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "report_key" VARCHAR(100) NOT NULL,
  "report_version" VARCHAR(20) NOT NULL,
  "parameters" JSONB NOT NULL,
  "requested_by" UUID NOT NULL,
  "snapshot_boundary" TIMESTAMPTZ NOT NULL,
  "state" "JobState" NOT NULL DEFAULT 'PENDING',
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "checksum_sha256" CHAR(64),
  "classification" VARCHAR(40) NOT NULL DEFAULT 'CONFIDENTIAL',
  "artifact_bucket" VARCHAR(160),
  "artifact_key" VARCHAR(500),
  "artifact_media_type" VARCHAR(100),
  "artifact_filename" VARCHAR(240),
  "failure_code" VARCHAR(100),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_runs_org_created_idx" ON "report_runs"("organization_id", "created_at" DESC);

CREATE TABLE "export_runs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "format" VARCHAR(10) NOT NULL,
  "filters" JSONB NOT NULL,
  "requested_by" UUID NOT NULL,
  "snapshot_boundary" TIMESTAMPTZ NOT NULL,
  "state" "JobState" NOT NULL DEFAULT 'PENDING',
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "checksum_sha256" CHAR(64),
  "artifact_bucket" VARCHAR(160),
  "artifact_key" VARCHAR(500),
  "artifact_media_type" VARCHAR(100),
  "artifact_filename" VARCHAR(240),
  "failure_code" VARCHAR(100),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "export_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "export_runs_org_created_idx" ON "export_runs"("organization_id", "created_at" DESC);

CREATE TABLE "operation_jobs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "dry_run" BOOLEAN NOT NULL DEFAULT true,
  "parameters" JSONB NOT NULL,
  "requested_by" UUID NOT NULL,
  "state" "JobState" NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "failure_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "operation_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "operation_jobs_org_created_idx" ON "operation_jobs"("organization_id", "created_at" DESC);

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "resource_type" VARCHAR(40) NOT NULL,
  "resource_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idempotency_records_org_key" ON "idempotency_records"("organization_id", "key");

CREATE OR REPLACE FUNCTION cdep_prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_records are append-only';
END;
$$;

CREATE TRIGGER audit_records_append_only
BEFORE UPDATE OR DELETE ON audit_records
FOR EACH ROW EXECUTE FUNCTION cdep_prevent_audit_mutation();
