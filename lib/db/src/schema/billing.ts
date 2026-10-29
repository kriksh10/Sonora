import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const creditAccounts = pgTable("credit_accounts", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  freeSessionsUsed: integer("free_sessions_used").notNull().default(0),
  unlimitedUntil: timestamp("unlimited_until", { withTimezone: true }),
});
export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  sessionId: text("session_id"),
  reference: text("reference").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const sessionBilling = pgTable("session_billing", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id").notNull(),
  autoExtend: boolean("auto_extend").notNull().default(false),
  billedBlocks: integer("billed_blocks").notNull().default(0),
});
export const sessionNotes = pgTable("session_notes", {
  sessionId: text("session_id").primaryKey(),
  summary: text("summary").notNull().default(""),
  questionsAsked: text("questions_asked").notNull().default(""),
  nextSteps: text("next_steps").notNull().default(""),
  score: integer("score"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type QuestionBankItem = { question: string; modelAnswer: string };
export const questionBanks = pgTable("question_banks", {
  sessionId: text("session_id").primaryKey(),
  items: jsonb("items").$type<QuestionBankItem[]>().notNull().default([]),
});
