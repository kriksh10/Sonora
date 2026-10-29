/** Local, bounded timing only. No question text, audio, identifiers or network logging. */
export function firstTextTiming(requestedAt: number, receivedAt?: number, now = performance.now()) {
  const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  return receivedAt === undefined
    ? `First text ${seconds(now - requestedAt)} after Ask`
    : `Speech to first answer ${seconds(now - receivedAt)} · model request ${seconds(now - requestedAt)}`;
}
