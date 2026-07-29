CREATE TABLE "workflow_recommendation_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "workflow_recommendation_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_assessment_provenance" (
    "id" UUID NOT NULL,
    "workflow_recommendation_draft_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "selected_items_json" JSONB NOT NULL,
    "accepted_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_assessment_provenance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_recommendation_drafts_organization_id_case_id_created_at_idx"
ON "workflow_recommendation_drafts"("organization_id", "case_id", "created_at");
CREATE UNIQUE INDEX "workflow_assessment_provenance_workflow_recommendation_draft_id_assessment_id_key"
ON "workflow_assessment_provenance"("workflow_recommendation_draft_id", "assessment_id");
CREATE INDEX "workflow_assessment_provenance_assessment_id_idx"
ON "workflow_assessment_provenance"("assessment_id");

ALTER TABLE "workflow_recommendation_drafts"
ADD CONSTRAINT "workflow_recommendation_drafts_workflow_instance_id_fkey"
FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_assessment_provenance"
ADD CONSTRAINT "workflow_assessment_provenance_workflow_recommendation_draft_id_fkey"
FOREIGN KEY ("workflow_recommendation_draft_id") REFERENCES "workflow_recommendation_drafts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
