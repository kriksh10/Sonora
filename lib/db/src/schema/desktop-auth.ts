import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Five-minute, single-use handoffs. No passwords or sign-in tickets are persisted.
export const desktopAuthRequestsTable = pgTable("desktop_auth_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  challenge: text("challenge").notNull(),
  codeHash: text("code_hash").notNull(),
  status: text("status").notNull().default("pending"),
  userId: text("user_id"),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const insertDesktopAuthRequestSchema = createInsertSchema(desktopAuthRequestsTable).omit({ id: true });
export type DesktopAuthRequest = typeof desktopAuthRequestsTable.$inferSelect;
