-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EvidenceAssetStatus" AS ENUM ('AWAITING_CONTENT', 'PROCESSING', 'ACTIVE', 'ON_HOLD', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceVersionStatus" AS ENUM ('UPLOAD_PENDING', 'UPLOADED', 'SCANNING', 'AVAILABLE', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('USER_UPLOAD', 'SOURCE_TRIGGER_REFERENCE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "EvidenceVersionReason" AS ENUM ('INITIAL', 'CORRECTION', 'REPLACEMENT', 'DERIVED');

-- CreateEnum
CREATE TYPE "CreatedByType" AS ENUM ('USER', 'SERVICE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EvidenceRelationshipType" AS ENUM ('CORRECTS', 'REPLACES', 'DERIVED_FROM', 'SUPPORTS', 'RELATED_TO');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MalwareScanStatus" AS ENUM ('CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProcessingJobType" AS ENUM ('MALWARE_SCAN', 'INTEGRITY_CHECK', 'RECONCILE');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('PENDING', 'LEASED', 'RETRY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrityCheckStatus" AS ENUM ('PENDING', 'MATCH', 'MISMATCH', 'ERROR');

-- CreateEnum
CREATE TYPE "AccessOutcome" AS ENUM ('GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "LegalHoldAction" AS ENUM ('PLACED', 'RELEASED');

-- CreateEnum
CREATE TYPE "OrphanKind" AS ENUM ('QUARANTINE', 'CANONICAL', 'MISSING_CANONICAL', 'ABANDONED_UPLOAD');

-- CreateEnum
CREATE TYPE "OrphanStatus" AS ENUM ('CANDIDATE', 'RETAINED', 'CLEANED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "evidence_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_number" VARCHAR(40) NOT NULL,
    "primary_case_id" UUID NOT NULL,
    "classification_code" VARCHAR(80) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" VARCHAR(2000),
    "source_type" "EvidenceSourceType" NOT NULL,
    "source_system_id" UUID,
    "connector_id" UUID,
    "source_trigger_id" UUID,
    "external_reference" VARCHAR(240),
    "status" "EvidenceAssetStatus" NOT NULL DEFAULT 'AWAITING_CONTENT',
    "current_version_id" UUID,
    "latest_version_number" INTEGER NOT NULL DEFAULT 0,
    "retention_policy_code" VARCHAR(80),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_type" "CreatedByType" NOT NULL,
    "created_by_id" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(120) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "evidence_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "previous_version_id" UUID,
    "previous_sha256" CHAR(64),
    "processing_status" "EvidenceVersionStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
    "quarantine_bucket" VARCHAR(120),
    "quarantine_key" VARCHAR(300),
    "canonical_bucket" VARCHAR(120),
    "canonical_key" VARCHAR(300),
    "object_version_id" VARCHAR(300),
    "original_filename" VARCHAR(255) NOT NULL,
    "display_filename" VARCHAR(255) NOT NULL,
    "declared_media_type" VARCHAR(160),
    "detected_media_type" VARCHAR(160),
    "size_bytes" BIGINT,
    "sha256" CHAR(64),
    "scan_engine" VARCHAR(80),
    "scan_signature_version" VARCHAR(120),
    "scan_completed_at" TIMESTAMPTZ,
    "created_reason" "EvidenceVersionReason" NOT NULL,
    "source_received_at" TIMESTAMPTZ,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_type" "CreatedByType" NOT NULL,
    "created_by_id" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ,
    "failure_code" VARCHAR(80),
    "failure_detail_sanitized" VARCHAR(500),

    CONSTRAINT "evidence_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_case_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "linked_by" VARCHAR(120) NOT NULL,
    "linked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_case_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_relationships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_evidence_asset_id" UUID NOT NULL,
    "to_evidence_asset_id" UUID NOT NULL,
    "relationship_type" "EvidenceRelationshipType" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_upload_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'OPEN',
    "declared_size_bytes" BIGINT,
    "bytes_received" BIGINT NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "correlation_id" UUID NOT NULL,
    "failure_code" VARCHAR(80),

    CONSTRAINT "evidence_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "malware_scan_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "MalwareScanStatus" NOT NULL,
    "engine" VARCHAR(80) NOT NULL,
    "signature_version" VARCHAR(120),
    "finding_codes" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL,
    "failure_detail_sanitized" VARCHAR(500),

    CONSTRAINT "malware_scan_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_processing_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID,
    "integrity_check_id" UUID,
    "job_type" "ProcessingJobType" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" UUID,
    "lease_expires_at" TIMESTAMPTZ,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "last_error_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "evidence_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_integrity_checks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "status" "IntegrityCheckStatus" NOT NULL DEFAULT 'PENDING',
    "expected_sha256" CHAR(64) NOT NULL,
    "calculated_sha256" CHAR(64),
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "correlation_id" UUID NOT NULL,
    "failure_detail_sanitized" VARCHAR(500),

    CONSTRAINT "evidence_integrity_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_access_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "evidence_version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "outcome" "AccessOutcome" NOT NULL,
    "reason_code" VARCHAR(80),
    "correlation_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_access_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_legal_holds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_asset_id" UUID NOT NULL,
    "action" "LegalHoldAction" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "actor_id" UUID NOT NULL,
    "acted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "related_hold_id" UUID,

    CONSTRAINT "evidence_legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orphan_object_candidates" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "evidence_version_id" UUID,
    "bucket" VARCHAR(120) NOT NULL,
    "object_key" VARCHAR(300) NOT NULL,
    "kind" "OrphanKind" NOT NULL,
    "status" "OrphanStatus" NOT NULL DEFAULT 'CANDIDATE',
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligible_after" TIMESTAMPTZ NOT NULL,
    "last_checked_at" TIMESTAMPTZ,
    "detail_sanitized" VARCHAR(500),

    CONSTRAINT "orphan_object_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
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
    "actor_type" "CreatedByType" NOT NULL,
    "actor_id" VARCHAR(120) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_events" (
    "event_id" UUID NOT NULL,
    "organization_id" UUID,
    "event_type" VARCHAR(160) NOT NULL,
    "status" "InboxStatus" NOT NULL,
    "failure_code" VARCHAR(80),
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "evidence_classifications" (
    "code" VARCHAR(80) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "organization_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_classifications_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "evidence_assets_current_version_id_key" ON "evidence_assets"("current_version_id");

-- CreateIndex
CREATE INDEX "evidence_assets_organization_id_primary_case_id_updated_at_idx" ON "evidence_assets"("organization_id", "primary_case_id", "updated_at");

-- CreateIndex
CREATE INDEX "evidence_assets_organization_id_status_classification_code_idx" ON "evidence_assets"("organization_id", "status", "classification_code");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_assets_organization_id_evidence_number_key" ON "evidence_assets"("organization_id", "evidence_number");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_assets_organization_id_source_trigger_id_key" ON "evidence_assets"("organization_id", "source_trigger_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_versions_quarantine_key_key" ON "evidence_versions"("quarantine_key");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_versions_canonical_key_key" ON "evidence_versions"("canonical_key");

-- CreateIndex
CREATE INDEX "evidence_versions_organization_id_evidence_asset_id_created_idx" ON "evidence_versions"("organization_id", "evidence_asset_id", "created_at");

-- CreateIndex
CREATE INDEX "evidence_versions_processing_status_created_at_idx" ON "evidence_versions"("processing_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_versions_evidence_asset_id_version_number_key" ON "evidence_versions"("evidence_asset_id", "version_number");

-- CreateIndex
CREATE INDEX "evidence_case_links_organization_id_case_id_idx" ON "evidence_case_links"("organization_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_case_links_organization_id_evidence_asset_id_case__key" ON "evidence_case_links"("organization_id", "evidence_asset_id", "case_id");

-- CreateIndex
CREATE INDEX "evidence_relationships_organization_id_to_evidence_asset_id_idx" ON "evidence_relationships"("organization_id", "to_evidence_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_relationships_organization_id_from_evidence_asset__key" ON "evidence_relationships"("organization_id", "from_evidence_asset_id", "to_evidence_asset_id", "relationship_type");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_upload_sessions_evidence_version_id_key" ON "evidence_upload_sessions"("evidence_version_id");

-- CreateIndex
CREATE INDEX "evidence_upload_sessions_status_expires_at_idx" ON "evidence_upload_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "malware_scan_attempts_organization_id_evidence_version_id_idx" ON "malware_scan_attempts"("organization_id", "evidence_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "malware_scan_attempts_evidence_version_id_attempt_number_key" ON "malware_scan_attempts"("evidence_version_id", "attempt_number");

-- CreateIndex
CREATE INDEX "evidence_processing_jobs_status_available_at_lease_expires__idx" ON "evidence_processing_jobs"("status", "available_at", "lease_expires_at");

-- CreateIndex
CREATE INDEX "evidence_processing_jobs_organization_id_evidence_version_i_idx" ON "evidence_processing_jobs"("organization_id", "evidence_version_id");

-- CreateIndex
CREATE INDEX "evidence_integrity_checks_organization_id_evidence_asset_id_idx" ON "evidence_integrity_checks"("organization_id", "evidence_asset_id", "requested_at");

-- CreateIndex
CREATE INDEX "evidence_access_records_organization_id_evidence_asset_id_o_idx" ON "evidence_access_records"("organization_id", "evidence_asset_id", "occurred_at");

-- CreateIndex
CREATE INDEX "evidence_legal_holds_organization_id_evidence_asset_id_acte_idx" ON "evidence_legal_holds"("organization_id", "evidence_asset_id", "acted_at");

-- CreateIndex
CREATE INDEX "orphan_object_candidates_status_eligible_after_idx" ON "orphan_object_candidates"("status", "eligible_after");

-- CreateIndex
CREATE UNIQUE INDEX "orphan_object_candidates_bucket_object_key_kind_key" ON "orphan_object_candidates"("bucket", "object_key", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organization_id_idempotency_key_operati_key" ON "idempotency_records"("organization_id", "idempotency_key", "operation");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_next_attempt_at_occurred_at_idx" ON "outbox_events"("published_at", "next_attempt_at", "occurred_at");

-- CreateIndex
CREATE INDEX "inbox_events_organization_id_processed_at_idx" ON "inbox_events"("organization_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_classifications_organization_id_code_key" ON "evidence_classifications"("organization_id", "code");

-- Concurrency-safe server-side evidence number allocation.
CREATE SEQUENCE "evidence_number_seq" START 1;

-- Domain constraints and organization-consistent ownership.
ALTER TABLE "evidence_versions"
  ADD CONSTRAINT "evidence_versions_asset_fkey"
  FOREIGN KEY ("evidence_asset_id") REFERENCES "evidence_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "evidence_versions_sha256_check"
  CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "evidence_versions_previous_sha256_check"
  CHECK ("previous_sha256" IS NULL OR "previous_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "evidence_versions_lineage_check"
  CHECK (
    ("version_number" = 1 AND "previous_version_id" IS NULL AND "previous_sha256" IS NULL)
    OR
    ("version_number" > 1 AND "previous_version_id" IS NOT NULL AND "previous_sha256" IS NOT NULL)
  );
ALTER TABLE "evidence_assets"
  ADD CONSTRAINT "evidence_assets_current_version_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "evidence_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "evidence_case_links"
  ADD CONSTRAINT "evidence_case_links_asset_fkey"
  FOREIGN KEY ("evidence_asset_id") REFERENCES "evidence_assets"("id") ON DELETE RESTRICT;
ALTER TABLE "evidence_relationships"
  ADD CONSTRAINT "evidence_relationships_from_fkey"
  FOREIGN KEY ("from_evidence_asset_id") REFERENCES "evidence_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "evidence_relationships_to_fkey"
  FOREIGN KEY ("to_evidence_asset_id") REFERENCES "evidence_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "evidence_relationships_no_self_check"
  CHECK ("from_evidence_asset_id" <> "to_evidence_asset_id");
ALTER TABLE "evidence_upload_sessions"
  ADD CONSTRAINT "evidence_upload_sessions_asset_fkey"
  FOREIGN KEY ("evidence_asset_id") REFERENCES "evidence_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "evidence_upload_sessions_version_fkey"
  FOREIGN KEY ("evidence_version_id") REFERENCES "evidence_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "malware_scan_attempts"
  ADD CONSTRAINT "malware_scan_attempts_version_fkey"
  FOREIGN KEY ("evidence_version_id") REFERENCES "evidence_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "evidence_integrity_checks"
  ADD CONSTRAINT "evidence_integrity_checks_version_fkey"
  FOREIGN KEY ("evidence_version_id") REFERENCES "evidence_versions"("id") ON DELETE RESTRICT;

-- Finalized version metadata is write-once. Only pre-final processing records can change.
CREATE FUNCTION prevent_finalized_evidence_version_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."processing_status" IN ('AVAILABLE', 'REJECTED')
     AND (
       NEW."evidence_asset_id" <> OLD."evidence_asset_id"
       OR NEW."version_number" <> OLD."version_number"
       OR NEW."canonical_bucket" IS DISTINCT FROM OLD."canonical_bucket"
       OR NEW."canonical_key" IS DISTINCT FROM OLD."canonical_key"
       OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
       OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
       OR NEW."detected_media_type" IS DISTINCT FROM OLD."detected_media_type"
       OR NEW."created_at" <> OLD."created_at"
       OR NEW."created_by_id" <> OLD."created_by_id"
     )
  THEN
    RAISE EXCEPTION 'Finalized evidence version metadata is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER evidence_versions_immutable
BEFORE UPDATE ON "evidence_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_evidence_version_mutation();

INSERT INTO "evidence_classifications" ("code", "display_name") VALUES
  ('IDENTITY', 'Identity'),
  ('INCOME', 'Income'),
  ('BANK_STATEMENT', 'Bank statement'),
  ('CREDIT_REPORT', 'Credit report'),
  ('APPLICATION_FORM', 'Application form'),
  ('COLLATERAL', 'Collateral'),
  ('CORRESPONDENCE', 'Correspondence'),
  ('DECISION_RECORD', 'Decision record'),
  ('OTHER', 'Other')
ON CONFLICT ("code") DO NOTHING;
