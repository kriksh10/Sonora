import {
  boolean,
  jsonb,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type TranscriptEntry = {
  roundNumber?: number;
  role: "user" | "assistant";
  text: string;
  source: "typed" | "microphone" | "system" | "ai";
  speaker?: "candidate" | "interviewer" | "unknown";
  capturedAt?: string;
  createdAt: string;
};

export type AnswerPreferences = {
  format: "full_script" | "script_bullets" | "bullet_points";
  length: "short" | "balanced" | "long";
  tone: "simple" | "formal";
  starMethod: boolean;
  fillerWords: boolean;
};

export const callSessionsTable = pgTable("call_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  sessionType: text("session_type").notNull(),
  title: text("title").notNull(),
  company: text("company"),
  description: text("description"),
  resumeText: text("resume_text").notNull().default(""),
  documentsText: text("documents_text").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  answerPreference: text("answer_preference").notNull().default("concise"),
  answerPreferences: jsonb("answer_preferences").$type<AnswerPreferences>(),
  model: text("model").notNull().default("gemini-2.5-flash"),
  language: text("language").notNull().default("English"),
  autoAnswer: boolean("auto_answer").notNull().default(false),
  saveTranscript: boolean("save_transcript").notNull().default(true),
  status: text("status").notNull().default("ready"),
  transcript: jsonb("transcript")
    .$type<TranscriptEntry[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  roundNumber: integer("round_number").notNull().default(1),
  rounds: jsonb("rounds").$type<{ number: number; startedAt: string | null; endedAt: string | null }[]>().notNull().default([]),
  restartRequestId: text("restart_request_id"),
});

export type CallSession = typeof callSessionsTable.$inferSelect;
export type NewCallSession = typeof callSessionsTable.$inferInsert;

export const answerDefaultsTable = pgTable("answer_defaults", {
  userId: text("user_id").primaryKey(),
  preferences: jsonb("preferences").$type<AnswerPreferences>().notNull(),
});
