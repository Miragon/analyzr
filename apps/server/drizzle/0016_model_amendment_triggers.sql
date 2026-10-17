-- Model amendments and their withdrawals (M6 S5c-2, §4.8 c): history guarantees.
-- Hand-written (drizzle-kit generate --custom); drizzle-kit does not model triggers.
--
-- An amendment is recorded once and never changed or deleted, and so is its end
-- (withdrawn by a human, or superseded by a later amendment of the same element and op),
-- like the other history tables (0001, 0005, 0007, 0010, 0012, 0014): a new value is a new
-- amendment row, a withdrawal a new withdrawal row. Carrying a value over from the source
-- tool is computed from the head's plan, never written.
CREATE TRIGGER "model_amendment_append_only" BEFORE UPDATE OR DELETE ON "model_amendment"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE TRIGGER "model_amendment_no_truncate" BEFORE TRUNCATE ON "model_amendment"
  FOR EACH STATEMENT EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE TRIGGER "model_amendment_withdrawal_append_only" BEFORE UPDATE OR DELETE ON "model_amendment_withdrawal"
  FOR EACH ROW EXECUTE FUNCTION "analyzr_forbid_change"();
--> statement-breakpoint
CREATE TRIGGER "model_amendment_withdrawal_no_truncate" BEFORE TRUNCATE ON "model_amendment_withdrawal"
  FOR EACH STATEMENT EXECUTE FUNCTION "analyzr_forbid_change"();
