export type DragPhase = "start" | "move" | "end";
export type DragPointer = "down" | "move" | "up" | "cancel";

/**
 * A window drag is armed only by a primary-button press.
 * Hover, a button-up, or a cancelled press ends it and does not move the window.
 */
export function windowDragAction(input: {
  type: DragPointer;
  button: number;
  buttons: number;
  armed: boolean;
}): { armed: boolean; phase: DragPhase | null } {
  if (input.type === "down") {
    if (input.button !== 0) return { armed: input.armed, phase: null };
    return { armed: true, phase: "start" };
  }
  if (!input.armed) return { armed: false, phase: null };
  if (input.type === "up" || input.type === "cancel" || (input.buttons & 1) === 0) {
    return { armed: false, phase: "end" };
  }
  if (input.type === "move") return { armed: true, phase: "move" };
  return { armed: true, phase: null };
}
