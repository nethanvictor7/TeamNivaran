CREATE TYPE "ProofKind" AS ENUM ('EVIDENCE', 'DECISION');
CREATE TYPE "ProofRequestState" AS ENUM ('PENDING', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'CONFLICT');

CREATE TABLE "ledger_provider_configurations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_type" VARCHAR(30) NOT NULL,
  "network_reference" VARCHAR(160) NOT NULL,
  "contract_reference" VARCHAR(160) NOT NULL,
  "metadata_schema_version" VARCHAR(20) NOT NULL DEFAULT '1.0',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_provider_configurations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ledger_provider_configurations_provider_key" ON "ledger_provider_configurations"("provider_type","network_reference","contract_reference");

CREATE TABLE "proof_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "proof_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "kind" "ProofKind" NOT NULL,
  "evidence_asset_id" UUID,
  "evidence_version_id" UUID,
  "decision_id" UUID,
  "canonical_payload_json" JSONB NOT NULL,
  "canonical_sha256" CHAR(64) NOT NULL,
  "provider_type" VARCHAR(30) NOT NULL,
  "state" "ProofRequestState" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ,
  "lease_owner" VARCHAR(160),
  "lease_expires_at" TIMESTAMPTZ,
  "safe_error_code" VARCHAR(100),
  "requested_by" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMPTZ,
  "confirmed_at" TIMESTAMPTZ,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  "correlation_id" UUID NOT NULL,
  CONSTRAINT "proof_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proof_requests_sha_check" CHECK ("canonical_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "proof_requests_target_check" CHECK (
    ("kind" = 'EVIDENCE' AND "evidence_asset_id" IS NOT NULL AND "evidence_version_id" IS NOT NULL AND "decision_id" IS NULL)
    OR ("kind" = 'DECISION' AND "decision_id" IS NOT NULL AND "evidence_asset_id" IS NULL AND "evidence_version_id" IS NULL)
  )
);
CREATE UNIQUE INDEX "proof_requests_proof_id_key" ON "proof_requests"("proof_id");
CREATE UNIQUE INDEX "proof_requests_evidence_key" ON "proof_requests"("organization_id","evidence_asset_id","evidence_version_id","kind");
CREATE UNIQUE INDEX "proof_requests_decision_key" ON "proof_requests"("organization_id","case_id","decision_id","kind");
CREATE INDEX "proof_requests_state_idx" ON "proof_requests"("state","next_attempt_at","requested_at");
CREATE INDEX "proof_requests_case_idx" ON "proof_requests"("organization_id","case_id","requested_at");

CREATE TABLE "ledger_provider_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "proof_request_id" UUID NOT NULL,
  "provider_type" VARCHAR(30) NOT NULL,
  "provider_transaction_id" VARCHAR(200),
  "provider_proof_reference" VARCHAR(200),
  "provider_contract_reference" VARCHAR(160) NOT NULL,
  "provider_network_reference" VARCHAR(160) NOT NULL,
  "provider_metadata_schema_version" VARCHAR(20) NOT NULL DEFAULT '1.0',
  "provider_metadata_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_provider_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_provider_bindings_request_fkey" FOREIGN KEY ("proof_request_id") REFERENCES "proof_requests"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ledger_provider_bindings_request_key" ON "ledger_provider_bindings"("proof_request_id");
CREATE INDEX "ledger_provider_bindings_transaction_idx" ON "ledger_provider_bindings"("provider_type","provider_transaction_id");

CREATE TABLE "evidence_proof_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "proof_request_id" UUID NOT NULL,
  "proof_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "evidence_asset_id" UUID NOT NULL,
  "evidence_version_id" UUID NOT NULL,
  "content_sha256" CHAR(64) NOT NULL,
  "metadata_sha256" CHAR(64) NOT NULL,
  "previous_proof_id" UUID,
  "schema_version" VARCHAR(20) NOT NULL,
  "anchored_at" TIMESTAMPTZ,
  CONSTRAINT "evidence_proof_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evidence_proof_records_request_fkey" FOREIGN KEY ("proof_request_id") REFERENCES "proof_requests"("id") ON DELETE RESTRICT,
  CONSTRAINT "evidence_proof_records_hash_check" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$' AND "metadata_sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "evidence_proof_records_request_key" ON "evidence_proof_records"("proof_request_id");
CREATE UNIQUE INDEX "evidence_proof_records_proof_key" ON "evidence_proof_records"("proof_id");
CREATE INDEX "evidence_proof_records_target_idx" ON "evidence_proof_records"("organization_id","evidence_asset_id","evidence_version_id");

CREATE TABLE "decision_proof_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "proof_request_id" UUID NOT NULL,
  "proof_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "workflow_instance_id" UUID NOT NULL,
  "decision_id" UUID NOT NULL,
  "decision_outcome_code" VARCHAR(30) NOT NULL,
  "evidence_manifest_sha256" CHAR(64) NOT NULL,
  "recommendation_sha256" CHAR(64) NOT NULL,
  "decision_record_sha256" CHAR(64) NOT NULL,
  "schema_version" VARCHAR(20) NOT NULL,
  "anchored_at" TIMESTAMPTZ,
  CONSTRAINT "decision_proof_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_proof_records_request_fkey" FOREIGN KEY ("proof_request_id") REFERENCES "proof_requests"("id") ON DELETE RESTRICT,
  CONSTRAINT "decision_proof_records_hash_check" CHECK ("evidence_manifest_sha256" ~ '^[0-9a-f]{64}$' AND "recommendation_sha256" ~ '^[0-9a-f]{64}$' AND "decision_record_sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "decision_proof_records_request_key" ON "decision_proof_records"("proof_request_id");
CREATE UNIQUE INDEX "decision_proof_records_proof_key" ON "decision_proof_records"("proof_id");
CREATE UNIQUE INDEX "decision_proof_records_target_key" ON "decision_proof_records"("organization_id","case_id","decision_id");

CREATE TABLE "ledger_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "proof_request_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "provider_type" VARCHAR(30) NOT NULL,
  "provider_transaction_id" VARCHAR(200),
  "normalized_state" VARCHAR(40) NOT NULL,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "safe_error_code" VARCHAR(100),
  "submitted_at" TIMESTAMPTZ,
  "finalized_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_transactions_request_fkey" FOREIGN KEY ("proof_request_id") REFERENCES "proof_requests"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ledger_transactions_attempt_key" ON "ledger_transactions"("proof_request_id","attempt_number");
CREATE INDEX "ledger_transactions_provider_idx" ON "ledger_transactions"("provider_type","provider_transaction_id");

CREATE TABLE "ledger_reconciliation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requested_by" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "inspected" INTEGER NOT NULL DEFAULT 0,
  "confirmed" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "ledger_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verification_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "proof_request_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "off_ledger_hash_match" BOOLEAN NOT NULL,
  "ledger_proof_confirmed" BOOLEAN NOT NULL,
  "ledger_hash_match" BOOLEAN NOT NULL,
  "provider_state" VARCHAR(40) NOT NULL,
  "safe_error_code" VARCHAR(100),
  "verified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verification_attempts_request_fkey" FOREIGN KEY ("proof_request_id") REFERENCES "proof_requests"("id") ON DELETE RESTRICT
);
CREATE INDEX "verification_attempts_org_idx" ON "verification_attempts"("organization_id","verified_at");

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "route" VARCHAR(200) NOT NULL,
  "key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_body" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idempotency_records_scope_key" ON "idempotency_records"("organization_id","actor_id","route","key");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aggregate_type" VARCHAR(80) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "event_type" VARCHAR(160) NOT NULL,
  "event_version" VARCHAR(20) NOT NULL,
  "organization_id" UUID NOT NULL,
  "correlation_id" UUID NOT NULL,
  "causation_id" UUID,
  "actor_id" VARCHAR(120) NOT NULL,
  "payload" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events"("published_at","next_attempt_at","occurred_at");

CREATE TABLE "inbox_events" (
  "event_id" UUID NOT NULL,
  "event_type" VARCHAR(160) NOT NULL,
  "payload_sha256" CHAR(64) NOT NULL,
  "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id")
);

INSERT INTO "ledger_provider_configurations" (
  "id", "provider_type", "network_reference", "contract_reference", "metadata_schema_version", "enabled"
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  'FABRIC',
  'cdep-proof-channel',
  'cdep-proof-registry',
  '1.0',
  true
) ON CONFLICT DO NOTHING;
