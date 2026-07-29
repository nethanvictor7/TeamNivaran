CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW', 'DECISION_PENDING', 'DECIDED', 'CLOSED', 'CANCELLED');
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "CasePartyType" AS ENUM ('BORROWER', 'GUARANTOR', 'DIRECTOR', 'OTHER');
CREATE TYPE "AssignmentRole" AS ENUM ('OWNER', 'ANALYST', 'REVIEWER', 'OBSERVER');
CREATE SEQUENCE "case_number_seq" START 1;

CREATE TABLE "decision_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "case_number" VARCHAR(40) NOT NULL,
  "external_reference" VARCHAR(120),
  "case_type" VARCHAR(80) NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
  "priority" "CasePriority" NOT NULL DEFAULT 'NORMAL',
  "requested_amount_minor" INTEGER,
  "currency" CHAR(3),
  "opened_at" TIMESTAMPTZ,
  "decision_due_at" TIMESTAMPTZ,
  "closed_at" TIMESTAMPTZ,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "decision_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_cases_money_check" CHECK (
    ("requested_amount_minor" IS NULL AND "currency" IS NULL) OR
    ("requested_amount_minor" >= 0 AND "currency" ~ '^[A-Z]{3}$')
  )
);
CREATE TABLE "case_parties" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "case_id" UUID NOT NULL,
  "party_type" "CasePartyType" NOT NULL, "display_name" VARCHAR(240) NOT NULL,
  "external_reference" VARCHAR(120), "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_parties_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "case_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "case_id" UUID NOT NULL,
  "user_id" UUID NOT NULL, "role" "AssignmentRole" NOT NULL,
  "created_by" UUID NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_assignments_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "case_status_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "case_id" UUID NOT NULL,
  "from_status" "CaseStatus", "to_status" "CaseStatus" NOT NULL,
  "reason" VARCHAR(1000), "changed_by" UUID NOT NULL,
  "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "version" INTEGER NOT NULL,
  CONSTRAINT "case_status_history_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aggregate_type" VARCHAR(100) NOT NULL,
  "aggregate_id" UUID NOT NULL, "aggregate_version" INTEGER NOT NULL,
  "event_type" VARCHAR(160) NOT NULL, "event_version" VARCHAR(20) NOT NULL,
  "payload" JSONB NOT NULL, "correlation_id" UUID NOT NULL, "causation_id" UUID,
  "organization_id" UUID NOT NULL, "actor_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "published_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMPTZ,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "inbox_events" (
  "event_id" UUID NOT NULL, "event_type" VARCHAR(160) NOT NULL,
  "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id")
);
CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "response_status" INTEGER NOT NULL, "response_body" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "decision_cases_organization_id_updated_at_id_idx" ON "decision_cases"("organization_id", "updated_at", "id");
CREATE UNIQUE INDEX "decision_cases_organization_id_case_number_key" ON "decision_cases"("organization_id", "case_number");
CREATE UNIQUE INDEX "decision_cases_organization_id_external_reference_key" ON "decision_cases"("organization_id", "external_reference");
CREATE UNIQUE INDEX "case_assignments_case_id_user_id_role_key" ON "case_assignments"("case_id", "user_id", "role");
CREATE INDEX "case_status_history_case_id_changed_at_idx" ON "case_status_history"("case_id", "changed_at");
CREATE INDEX "outbox_events_published_at_next_attempt_at_occurred_at_idx" ON "outbox_events"("published_at", "next_attempt_at", "occurred_at");
CREATE UNIQUE INDEX "idempotency_records_organization_id_idempotency_key_key" ON "idempotency_records"("organization_id", "idempotency_key");
ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "decision_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "decision_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_status_history" ADD CONSTRAINT "case_status_history_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "decision_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
