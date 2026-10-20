-- The identity rows (M6 S2b follow-up step 5, owner decision 29 (1)): history guarantees, a guard
-- and the backfill. Hand-written (drizzle-kit generate --custom); drizzle-kit does not model
-- triggers.
--
-- A row is recorded once and never changed or deleted, like the other history tables (0001,
-- 0005, 0007, 0010, 0012, 0014, 0016, 0020). It names an uploaded revision of its model (an
-- amended revision declares nothing; readers follow `source.upstream`). A `revision` row is
-- exactly its revision's declaration, at its revision's seq, by its principal; an `unchanged` row
-- sits on its own `model.identity_declared` event, which names the row's model, revision, system
-- and tool id under the row's principal and client, and names the revision the live model's
-- unchanged bytes are kept as. The domain writes only such rows; this guard holds for any writer,
-- the backfill below included.
CREATE TRIGGER "model_identity_append_only" BEFORE UPDATE OR DELETE ON "model_identity"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE TRIGGER "model_identity_no_truncate" BEFORE TRUNCATE ON "model_identity"
  FOR EACH STATEMENT EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE FUNCTION "analyzr_model_identity_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  -- Every row: an uploaded revision of its model; a `revision` row also exactly its declaration,
  -- at its seq, by its principal.
  ok := EXISTS (
    SELECT 1 FROM "model_revision" r
    WHERE r."project_id" = NEW."project_id" AND r."model_id" = NEW."model_id"
      AND r."id" = NEW."revision_id"
      AND r."source"->>'kind' IS DISTINCT FROM 'amendment'
      AND (NEW."kind" <> 'revision' OR (
        r."seq" = NEW."seq"
        AND r."principal_id" = NEW."principal_id"
        AND r."source"->>'system' IS NOT DISTINCT FROM NEW."system"
        AND r."source"->>'externalId' IS NOT DISTINCT FROM NEW."external_id"
        AND r."source"->>'externalPath' IS NOT DISTINCT FROM NEW."external_path"
        AND r."source"->>'url' IS NOT DISTINCT FROM NEW."url")));
  -- An `unchanged` row: on its own event, which names its model, revision, system and tool id,
  -- by the same principal and client; and its revision is the one the live model's unchanged
  -- bytes are kept as (the head, or an amended head's `source.upstream`).
  IF ok AND NEW."kind" = 'unchanged' THEN
    ok := EXISTS (
      SELECT 1 FROM "event" e
      WHERE e."project_id" = NEW."project_id" AND e."seq" = NEW."seq"
        AND e."type" = 'model.identity_declared'
        AND e."principal_id" = NEW."principal_id"
        AND e."client_id" IS NOT DISTINCT FROM NEW."client_id"
        AND e."payload"->>'modelId' = NEW."model_id"
        AND e."payload"->>'revisionId' = NEW."revision_id"
        AND e."payload"->>'system' = NEW."system"
        AND e."payload"->>'externalId' IS NOT DISTINCT FROM NEW."external_id"
    ) AND EXISTS (
      SELECT 1 FROM "model" m
      JOIN "model_revision" h ON h."project_id" = m."project_id" AND h."id" = m."head_revision_id"
      WHERE m."project_id" = NEW."project_id" AND m."id" = NEW."model_id"
        AND m."deleted_seq" IS NULL
        AND coalesce(h."source"->'upstream'->>'revisionId', h."id") = NEW."revision_id"
    );
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'model_identity: revision % of the row is no uploaded revision of its model, or the row does not match its revision, its event or the model''s head', NEW."revision_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "model_identity_guard" BEFORE INSERT ON "model_identity"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_model_identity_guard"();
--> statement-breakpoint
-- Backfill: one row per uploaded revision a manifest declared (source.system set), of every
-- model, deleted ones too, with the revision's seq, principal and time and its model.revised
-- event's client. The newest row is then what RevisionRepo.uploadedSources read before (the
-- head's uploaded revision if declared, else the newest declared revision), so every reader
-- answers as before. The guard above checks every row. Idempotent: ON CONFLICT.
INSERT INTO "model_identity" ("project_id", "model_id", "seq", "revision_id", "kind", "system",
  "external_id", "external_path", "url", "principal_id", "client_id", "created_at")
SELECT r."project_id", r."model_id", r."seq", r."id", 'revision', r."source"->>'system',
  r."source"->>'externalId', r."source"->>'externalPath', r."source"->>'url',
  r."principal_id", e."client_id", r."created_at"
FROM "model_revision" r
LEFT JOIN "event" e ON e."project_id" = r."project_id" AND e."seq" = r."seq"
  AND e."type" = 'model.revised'
WHERE r."source"->>'system' IS NOT NULL
  AND r."source"->>'kind' IS DISTINCT FROM 'amendment'
ORDER BY r."project_id", r."model_id", r."seq"
ON CONFLICT DO NOTHING;
