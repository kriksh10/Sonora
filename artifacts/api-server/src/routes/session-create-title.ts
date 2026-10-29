import { interviewSessionTitle } from "../lib/interview-session-title";

/**
 * Title stored for a new session.
 * Interview titles honor the submitted value so "Role – Company" is kept.
 */
export function titleForNewSession(sessionType: "interview" | "call", submittedTitle: string, company: string) {
  if (sessionType === "interview") return interviewSessionTitle(submittedTitle, company);
  return submittedTitle.trim() || "Regular call";
}
