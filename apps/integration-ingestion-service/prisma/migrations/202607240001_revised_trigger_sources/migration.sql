ALTER TYPE "ConnectorType" ADD VALUE IF NOT EXISTS 'SQL_POLL';
COMMIT;
UPDATE "connector_definitions" SET "type" = 'SQL_POLL' WHERE "type"::text = 'POSTGRES_POLL';
ALTER TYPE "ConnectorType" RENAME TO "ConnectorType_legacy";
CREATE TYPE "ConnectorType" AS ENUM ('WEBHOOK', 'SQL_POLL');
ALTER TABLE "connector_definitions"
  ALTER COLUMN "type" TYPE "ConnectorType"
  USING "type"::text::"ConnectorType";
DROP TYPE "ConnectorType_legacy";

ALTER TABLE "connector_definitions"
  ADD COLUMN "connector_key" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "trigger_type" VARCHAR(160) NOT NULL DEFAULT 'source.trigger.received',
  ADD COLUMN "consecutive_failure_count" INTEGER NOT NULL DEFAULT 0,
  ALTER COLUMN "batch_size" DROP NOT NULL;
ALTER TABLE "connector_definitions" ALTER COLUMN "connector_key" DROP DEFAULT;
CREATE UNIQUE INDEX "connector_definitions_connector_key_key" ON "connector_definitions"("connector_key");

CREATE TABLE "field_extraction_rules" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "target_field" VARCHAR(80) NOT NULL,
  "source_path" VARCHAR(300) NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "default_value" VARCHAR(500),
  "transform" VARCHAR(40),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "field_extraction_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_extraction_rules_connector_id_fkey" FOREIGN KEY ("connector_id")
    REFERENCES "connector_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "field_extraction_rules_connector_id_target_field_key"
  ON "field_extraction_rules"("connector_id", "target_field");
CREATE INDEX "field_extraction_rules_organization_id_connector_id_idx"
  ON "field_extraction_rules"("organization_id", "connector_id");

ALTER TABLE "correlation_rule_sets" ADD COLUMN "connector_id" UUID;
DELETE FROM "correlation_rule_versions";
DELETE FROM "correlation_rule_sets";
ALTER TABLE "correlation_rule_sets" ALTER COLUMN "connector_id" SET NOT NULL;
CREATE UNIQUE INDEX "correlation_rule_sets_connector_id_key" ON "correlation_rule_sets"("connector_id");
ALTER TABLE "correlation_rule_versions"
  ADD COLUMN "rule_type" VARCHAR(80) NOT NULL DEFAULT 'EXTERNAL_REFERENCE_EQUALS',
  ADD COLUMN "reference_type" VARCHAR(80),
  ADD COLUMN "created_by" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "correlation_rule_versions"
  ALTER COLUMN "rule_type" DROP DEFAULT,
  ALTER COLUMN "created_by" DROP DEFAULT,
  DROP COLUMN "configuration_json",
  DROP COLUMN "tested_at";

ALTER TABLE "connector_checkpoints"
  ADD COLUMN "watermark" VARCHAR(200),
  ADD COLUMN "tie_breaker" VARCHAR(300);
UPDATE "connector_checkpoints"
SET "watermark" = COALESCE("watermark_json"->>'watermark', ''),
    "tie_breaker" = COALESCE("watermark_json"->>'tieBreaker', '');
ALTER TABLE "connector_checkpoints"
  ALTER COLUMN "watermark" SET NOT NULL,
  ALTER COLUMN "tie_breaker" SET NOT NULL;
ALTER TABLE "connector_checkpoints" DROP COLUMN "watermark_json";

ALTER TABLE "ingestion_runs"
  ADD COLUMN "checkpoint_before" JSONB,
  ADD COLUMN "checkpoint_after" JSONB;
CREATE INDEX "ingestion_runs_organization_id_connector_id_started_at_idx"
  ON "ingestion_runs"("organization_id", "connector_id", "started_at");

CREATE TYPE "SourceTriggerStatus" AS ENUM (
  'RECEIVED','EXTRACTION_FAILED','CORRELATION_PENDING','UNMATCHED',
  'AMBIGUOUS_CORRELATION','READY','PUBLISHED','FAILED'
);
ALTER TABLE "raw_source_events" RENAME TO "source_triggers";
DROP INDEX IF EXISTS "raw_source_events_organization_id_source_system_id_source_e_key";
ALTER TABLE "source_triggers"
  RENAME COLUMN "source_event_id" TO "source_record_id";
ALTER TABLE "source_triggers"
  RENAME COLUMN "source_metadata_json" TO "metadata_json";
ALTER TABLE "source_triggers"
  ADD COLUMN "connector_type" "ConnectorType",
  ADD COLUMN "trigger_type" VARCHAR(160),
  ADD COLUMN "idempotency_key" VARCHAR(500),
  ADD COLUMN "extracted_fields_json" JSONB,
  ADD COLUMN "case_id" UUID;
UPDATE "source_triggers" t SET
  "connector_type" = c."type",
  "trigger_type" = c."trigger_type",
  "idempotency_key" = CASE WHEN t."source_record_id" IS NULL THEN NULL
    ELSE 'legacy:' || t."source_record_id" END
FROM "connector_definitions" c WHERE c."id" = t."connector_id";
ALTER TABLE "source_triggers"
  ALTER COLUMN "connector_type" SET NOT NULL,
  ALTER COLUMN "trigger_type" SET NOT NULL,
  ALTER COLUMN "source_record_id" DROP NOT NULL;
ALTER TABLE "source_triggers"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "source_triggers"
  ALTER COLUMN "status" TYPE "SourceTriggerStatus"
  USING CASE
    WHEN "status"::text IN ('RECEIVED') THEN 'RECEIVED'::"SourceTriggerStatus"
    WHEN "status"::text IN ('UNMATCHED') THEN 'UNMATCHED'::"SourceTriggerStatus"
    WHEN "status"::text IN ('AMBIGUOUS_CORRELATION') THEN 'AMBIGUOUS_CORRELATION'::"SourceTriggerStatus"
    WHEN "status"::text IN ('PUBLISHED') THEN 'PUBLISHED'::"SourceTriggerStatus"
    WHEN "status"::text IN ('FAILED','SOURCE_ID_PAYLOAD_CONFLICT','MAPPING_FAILED','SCHEMA_INVALID') THEN 'FAILED'::"SourceTriggerStatus"
    ELSE 'RECEIVED'::"SourceTriggerStatus"
  END;
ALTER TABLE "source_triggers"
  ALTER COLUMN "status" SET DEFAULT 'RECEIVED';
ALTER TABLE "source_triggers" DROP COLUMN IF EXISTS "source_event_type";
CREATE UNIQUE INDEX "source_triggers_organization_id_connector_id_idempotency_key_key"
  ON "source_triggers"("organization_id", "connector_id", "idempotency_key");
CREATE INDEX "source_triggers_organization_id_status_received_at_idx"
  ON "source_triggers"("organization_id", "status", "received_at");

DROP TABLE IF EXISTS "canonical_events";
CREATE TABLE "canonical_trigger_events" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "source_trigger_id" UUID NOT NULL,
  "case_id" UUID,
  "event_json" JSONB NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "published_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canonical_trigger_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "canonical_trigger_events_source_trigger_id_key"
  ON "canonical_trigger_events"("source_trigger_id");

ALTER TABLE "event_processing_attempts" RENAME TO "processing_attempts";
ALTER TABLE "processing_attempts" RENAME COLUMN "raw_source_event_id" TO "source_trigger_id";
CREATE INDEX "processing_attempts_organization_id_source_trigger_id_created_at_idx"
  ON "processing_attempts"("organization_id", "source_trigger_id", "created_at");

ALTER TABLE "failed_events" RENAME TO "failed_triggers";
ALTER TABLE "failed_triggers" RENAME COLUMN "raw_source_event_id" TO "source_trigger_id";
CREATE INDEX "failed_triggers_organization_id_resolved_at_idx"
  ON "failed_triggers"("organization_id", "resolved_at");

ALTER TABLE "journey_correlations" RENAME COLUMN "raw_source_event_id" TO "source_trigger_id";
ALTER TABLE "journey_correlations"
  ADD COLUMN "resolved_by" UUID,
  ADD COLUMN "resolution_reason" VARCHAR(1000),
  ADD COLUMN "previous_state" VARCHAR(40);
CREATE INDEX "journey_correlations_organization_id_source_trigger_id_created_at_idx"
  ON "journey_correlations"("organization_id", "source_trigger_id", "created_at");

ALTER TABLE "decision_journey_events" RENAME COLUMN "raw_source_event_id" TO "source_trigger_id";
ALTER TABLE "decision_journey_events" RENAME COLUMN "source_event_id" TO "source_record_id";
ALTER TABLE "decision_journey_events"
  ALTER COLUMN "source_record_id" DROP NOT NULL,
  ADD COLUMN "causation_id" UUID;
CREATE INDEX "decision_journey_events_organization_id_source_trigger_id_idx"
  ON "decision_journey_events"("organization_id", "source_trigger_id");

ALTER TABLE "replay_requests" RENAME COLUMN "raw_source_event_id" TO "source_trigger_id";
ALTER TABLE "replay_requests" ADD COLUMN "reason" VARCHAR(1000) NOT NULL DEFAULT 'Operational replay';
ALTER TABLE "replay_requests" ALTER COLUMN "reason" DROP DEFAULT;
ALTER TABLE "replay_requests" DROP COLUMN IF EXISTS "mapping_version_id";

DROP TABLE IF EXISTS "field_mapping_rules";
DROP TABLE IF EXISTS "event_mapping_versions";
DROP TABLE IF EXISTS "event_mapping_sets";
DROP TABLE IF EXISTS "custom_event_definitions";
DROP TABLE IF EXISTS "source_schemas";
