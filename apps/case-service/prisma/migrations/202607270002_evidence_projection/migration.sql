CREATE TABLE "case_evidence_projections" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "evidence_asset_id" UUID NOT NULL,
  "current_version_id" UUID,
  "evidence_number" VARCHAR(40) NOT NULL,
  "classification_code" VARCHAR(80) NOT NULL,
  "evidence_status" VARCHAR(40) NOT NULL,
  "source_type" VARCHAR(40) NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "case_evidence_projections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_evidence_projections_case_fkey"
    FOREIGN KEY ("case_id") REFERENCES "decision_cases"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "case_evidence_projections_organization_id_evidence_asset_id_key"
  ON "case_evidence_projections"("organization_id", "evidence_asset_id");
CREATE INDEX "case_evidence_projections_organization_id_case_id_occurred_at_idx"
  ON "case_evidence_projections"("organization_id", "case_id", "occurred_at");

CREATE TABLE "case_evidence_timeline_events" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "evidence_asset_id" UUID NOT NULL,
  "event_type" VARCHAR(160) NOT NULL,
  "evidence_status" VARCHAR(40) NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "case_evidence_timeline_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_evidence_timeline_events_case_fkey"
    FOREIGN KEY ("case_id") REFERENCES "decision_cases"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "case_evidence_timeline_events_event_id_key"
  ON "case_evidence_timeline_events"("event_id");
CREATE INDEX "case_evidence_timeline_events_organization_id_case_id_occurred_at_idx"
  ON "case_evidence_timeline_events"("organization_id", "case_id", "occurred_at");
