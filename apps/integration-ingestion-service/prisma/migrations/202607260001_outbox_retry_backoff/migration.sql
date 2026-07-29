ALTER TABLE "outbox_events"
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ;

DROP INDEX IF EXISTS "outbox_events_published_at_occurred_at_idx";

CREATE INDEX "outbox_events_published_at_next_attempt_at_occurred_at_idx"
  ON "outbox_events"("published_at", "next_attempt_at", "occurred_at");
