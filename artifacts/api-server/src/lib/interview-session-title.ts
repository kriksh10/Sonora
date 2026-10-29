/**
 * Interview session title.
 * The client sends "Role – Company" when a job role was entered.
 * An empty title falls back to the company, then a generic label.
 */
export function interviewSessionTitle(submittedTitle: string, company: string) {
  const explicit = submittedTitle.trim();
  const org = company.trim();
  return (explicit || org || "Interview session").slice(0, 200);
}