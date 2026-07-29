CREATE TABLE "case_external_references" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "source_system_id" UUID NOT NULL,
  "reference_type" VARCHAR(80) NOT NULL,
  "reference_value" VARCHAR(240) NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_external_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_external_references_case_id_fkey" FOREIGN KEY ("case_id")
    REFERENCES "decision_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "case_external_references_org_source_type_value_key"
  ON "case_external_references"("organization_id", "source_system_id", "reference_type", "reference_value");
CREATE INDEX "case_external_references_case_id_idx" ON "case_external_references"("case_id");
