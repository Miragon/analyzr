-- The owner's reviews of revisions stored before the trust rule (M6 S2c-4): history guarantees.
-- Hand-written (drizzle-kit generate --custom); drizzle-kit does not model triggers.
--
-- A review is recorded once and never changed or deleted, like the other history tables (0001,
-- 0005, 0007, 0010, 0012, 0014, 0016). It names an uploaded revision that carries no trust class:
-- the trust rule's class (`source.trust`, set since S2c) is never overruled by a review, and an
-- amended revision (`source.kind` `amendment`) has no class of its own (readers follow
-- `source.upstream`). The domain refuses both first (422); this guard holds for any writer.
CREATE TRIGGER "revision_trust_review_append_only" BEFORE UPDATE OR DELETE ON "revision_trust_review"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE TRIGGER "revision_trust_review_no_truncate" BEFORE TRUNCATE ON "revision_trust_review"
  FOR EACH STATEMENT EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE FUNCTION "analyzr_trust_review_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "model_revision" r
    WHERE r."project_id" = NEW."project_id" AND r."id" = NEW."revision_id"
      AND (r."source" ? 'trust' OR r."source"->>'kind' = 'amendment')
  ) THEN
    RAISE EXCEPTION 'revision_trust_review: revision % carries a trust class or is amended; only an uploaded revision stored before the trust rule is reviewed', NEW."revision_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "revision_trust_review_guard" BEFORE INSERT ON "revision_trust_review"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_trust_review_guard"();
