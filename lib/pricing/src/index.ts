/**
 * Placeholder prices. TODO-confirm before any live charge.
 * These are not a published offer until Sai confirms them.
 */
export const PRICE_STATUS = "TODO-confirm" as const;

export const FREE_SESSION_LIMIT = 10;
export const FREE_SESSION_MINUTES = 10;
export const BILLING_BLOCK_MINUTES = 30;

export type PlanId = "daily" | "weekly" | "monthly" | "yearly";
export type PackId = "pack-1" | "pack-3" | "pack-6";
export type SkuId = PlanId | PackId;

export type Plan = {
  id: PlanId;
  name: string;
  priceCents: number;
  /** How long unlimited use lasts after purchase. */
  durationHours: number;
};

export type CreditPack = {
  id: PackId;
  credits: number;
  priceCents: number;
};

export const PLANS: readonly Plan[] = [
  { id: "daily", name: "Daily pass", priceCents: 999, durationHours: 24 },
  { id: "weekly", name: "Weekly unlimited", priceCents: 2900, durationHours: 24 * 7 },
  { id: "monthly", name: "Monthly unlimited", priceCents: 7900, durationHours: 24 * 30 },
  { id: "yearly", name: "Yearly unlimited", priceCents: 39900, durationHours: 24 * 365 },
];

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "pack-1", credits: 1, priceCents: 1500 },
  { id: "pack-3", credits: 3, priceCents: 3900 },
  { id: "pack-6", credits: 6, priceCents: 6900 },
];

export function formatUsd(cents: number) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function findSku(id: string): Plan | CreditPack | undefined {
  return PLANS.find((plan) => plan.id === id) ?? CREDIT_PACKS.find((pack) => pack.id === id);
}

export function isPlan(sku: Plan | CreditPack): sku is Plan {
  return "durationHours" in sku;
}

/** Credits consumed by one session. Owner and approver accounts are not billed. */
export function creditsForSession(input: {
  role: "owner" | "approver" | "user" | string;
  freeSessionsUsed: number;
  elapsedMinutes: number;
  unlimitedUntilMs: number | null;
  nowMs: number;
}) {
  if (input.role === "owner" || input.role === "approver") return { credits: 0, reason: "bypass" as const };
  if (input.unlimitedUntilMs !== null && input.unlimitedUntilMs > input.nowMs) {
    return { credits: 0, reason: "pass" as const };
  }
  const withinFreeCount = input.freeSessionsUsed < FREE_SESSION_LIMIT;
  const minutes = withinFreeCount
    ? Math.max(0, input.elapsedMinutes - FREE_SESSION_MINUTES)
    : Math.max(0, input.elapsedMinutes);
  if (minutes <= 0 && withinFreeCount) return { credits: 0, reason: "free" as const };
  const billable = minutes <= 0 ? BILLING_BLOCK_MINUTES : minutes;
  return {
    credits: Math.ceil(billable / BILLING_BLOCK_MINUTES),
    reason: "blocks" as const,
  };
}

export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]["id"];

export function resolveGeminiModel(value: string | undefined): GeminiModelId {
  const match = GEMINI_MODELS.find((model) => model.id === value);
  return match?.id ?? "gemini-2.5-flash";
}
