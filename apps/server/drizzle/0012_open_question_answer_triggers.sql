-- Answers to open questions (M6 S5a): history guarantees.
-- Hand-written (drizzle-kit generate --custom); drizzle-kit does not model triggers.
--
-- An answer is recorded once and never changed or deleted, like the other
-- history tables (0001, 0005, 0007, 0010): a later answer adds a row, and an
-- answer whose item's source changed stays with the old item id.
CREATE TRIGGER "open_question_answer_append_only" BEFORE UPDATE OR DELETE ON "open_question_answer"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE TRIGGER "open_question_answer_no_truncate" BEFORE TRUNCATE ON "open_question_answer"
  FOR EACH STATEMENT EXECUTE FUNCTION "analyzr_forbid_change"();
