/** Match the known third-party SDK load failure, never general application errors. */
export function isClerkLoadFailure(value: unknown) {
  const message = value instanceof Error ? value.message
    : typeof value === "string" ? value
    : value && typeof value === "object" && "message" in value ? String(value.message) : "";
  return /failed_to_load_clerk_js|Clerk:\s*Failed to load Clerk JS/i.test(message);
}
