import { clerkClient } from "@clerk/express";
import { ensureAccess } from "./app-access";
import { logger } from "./logger";

/** Executes against this runtime's Clerk environment. It never creates unverifiable accounts. */
export async function bootstrapConfiguredAccess() {
  for (const email of [process.env.SONORA_OWNER_EMAIL, process.env.SONORA_APPROVER_EMAIL].filter(Boolean)) {
    const users = await clerkClient.users.getUserList({ emailAddress: [email!.trim()], limit: 10 });
    for (const user of users.data) {
      const primary = user.emailAddresses.find(item => item.id === user.primaryEmailAddressId);
      if (primary?.emailAddress.toLowerCase() === email!.trim().toLowerCase() && primary.verification?.status === "verified") {
        await ensureAccess(user.id);
      }
    }
  }
  logger.info("Configured access bootstrap checked verified target-environment identities");
}
