-- Withdrawals of outside marks (M6 S5c-1, §4.8 b): history guarantees.
-- Hand-written (drizzle-kit generate --custom); drizzle-kit does not model triggers.
--
-- A withdrawal is recorded once and never changed or deleted, like the answers it
-- ends (0012) and the other history tables (0001, 0005, 0007, 0010): marking again
-- records a new answer row, which a later withdrawal ends in turn.
CREATE TRIGGER "open_question_answer_withdrawal_append_only" BEFORE UPDATE OR DELETE ON "open_question_answer_withdrawal"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE TRIGGER "open_question_answer_withdrawal_no_truncate" BEFORE TRUNCATE ON "open_question_answer_withdrawal"
  FOR EACH STATEMENT EXECUTE FUNCTION "analyzr_forbid_change"();
