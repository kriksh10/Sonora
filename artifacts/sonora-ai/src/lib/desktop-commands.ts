export type DesktopCommandContext = {
  question: string;
  latestQuestion: string;
  recentPhoneText: string;
  answer: string;
  assistantAnswers: string[];
  inputMode: "phone" | "computer";
};

export type DesktopCommandResult =
  | { type: "ask"; question: string; source: "typed" | "microphone" }
  | { type: "ask-recent" }
  | { type: "again" }
  | { type: "show-answer"; answer: string }
  | { type: "scroll"; top: number }
  | { type: "clear-answers" }
  | { type: "clear-transcript" }
  | { type: "screenshot" }
  | { type: "ignore" };

export function neighborAnswer(answers: string[], current: string, direction: 1 | -1) {
  if (!answers.length) return null;
  let index = answers.lastIndexOf(current);
  if (index < 0) index = answers.length - 1;
  const next = index + direction;
  if (next < 0 || next >= answers.length) return null;
  return answers[next];
}

/** Maps a main-process hotkey id to a renderer effect. Window moves stay in the shell. */
export function interpretDesktopCommand(action: string, ctx: DesktopCommandContext): DesktopCommandResult {
  switch (action) {
    case "answer": {
      const typed = ctx.question.trim();
      if (typed) return { type: "ask", question: typed, source: "typed" };
      if (ctx.inputMode === "phone" && ctx.recentPhoneText.trim()) return { type: "ask-recent" };
      const latest = ctx.latestQuestion.trim();
      return latest ? { type: "ask", question: latest, source: "typed" } : { type: "ignore" };
    }
    case "alternate":
      return ctx.latestQuestion.trim() ? { type: "again" } : { type: "ignore" };
    case "scrollUp":
      return { type: "scroll", top: -180 };
    case "scrollDown":
      return { type: "scroll", top: 180 };
    case "previous":
    case "next": {
      const answer = neighborAnswer(ctx.assistantAnswers, ctx.answer, action === "next" ? 1 : -1);
      return answer ? { type: "show-answer", answer } : { type: "ignore" };
    }
    case "clearAnswers":
      return { type: "clear-answers" };
    case "clearTranscript":
      return { type: "clear-transcript" };
    case "screenshot":
      return { type: "screenshot" };
    default:
      return { type: "ignore" };
  }
}
