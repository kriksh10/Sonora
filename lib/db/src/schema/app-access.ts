import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const appAccessTable = pgTable("app_access", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "approver", "user"] }).notNull().default("user"),
  status: text("status", { enum: ["pending", "approved", "denied", "revoked"] }).notNull().default("pending"),
  requested: boolean("requested").notNull().default(false),
  bootstrapApplied: boolean("bootstrap_applied").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertAppAccessSchema = createInsertSchema(appAccessTable);
export type AppAccess = typeof appAccessTable.$inferSelect;
