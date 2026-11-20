import { pool } from "@workspace/db";

/** Existing databases predate the answer-language column. Adding it is safe to repeat. */
export async function ensureAnswerLanguageColumn() {
  await pool.query(
    "ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS answer_language text NOT NULL DEFAULT 'English'",
  );
}
