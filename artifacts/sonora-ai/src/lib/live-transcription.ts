/** Authenticated server-side Speechmatics proxy. No provider credentials reach the browser. */
export function createLiveTranscription(options: {
  sessionId: string; source: "microphone" | "system"; roundNumber?: number;
  onUpdate: (update: { text?: string; partial?: string; speaker?: string; final?: boolean; endOfTurn?: boolean; endTime?: number }) => void;
  onFallback: (reason: string) => void;
}) {
  let socket: WebSocket | undefined, stopped = false, failed = false, opened = false;
  let lastReply = Date.now(), watchdog: ReturnType<typeof setInterval> | undefined;
  let lastSent: number | undefined;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const endpoint = `${base}/api/sessions/${options.sessionId}/live-audio`;
  const abort = new AbortController();
  const fallback = (reason: string) => {
    if (stopped || failed) return;
    failed = true; clearInterval(watchdog); socket?.close();
    options.onFallback(reason);
  };
  return {
    async start() {
      try {
        if (typeof WebSocket === "undefined") throw new Error("Live WebSocket unavailable");
        const response = await fetch(endpoint, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
          body: JSON.stringify({ open: true, source: options.source, roundNumber: options.roundNumber }),
        });
        if (!response.ok) throw new Error(`Live service unavailable (${response.status})`);
        opened = true;
        const { ticket } = await response.json();
        if (stopped) return;
        const url = new URL(`${base}/api/live-audio`, window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("ticket", ticket);
        socket = new WebSocket(url);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { socket?.close(); reject(new Error("Live socket startup timeout")); }, 7000);
          const done = () => { clearTimeout(timer); resolve(); };
          socket!.onmessage = event => {
            lastReply = Date.now();
            try {
              const update = JSON.parse(event.data);
              if (update.error) { fallback("Speechmatics provider failure"); reject(new Error("Live provider failed")); }
              else if (update.ready) done();
              else options.onUpdate(update);
            } catch { fallback("Invalid live transcription response"); }
          };
          socket!.onerror = () => { clearTimeout(timer); reject(new Error("Live socket failure")); fallback("Live socket failure"); };
          socket!.onclose = () => { clearTimeout(timer); reject(new Error("Live socket closed")); fallback("Live socket closed"); };
        });
        watchdog = setInterval(() => {
          const now = Date.now();
          if (lastSent !== undefined && now - lastSent < 4000 && now - lastReply > 15000)
            fallback("Live stream stopped acknowledging audio");
        }, 3000);
      } catch (error) { fallback(error instanceof Error ? error.message : "Live startup failed"); }
    },
    send(bytes: Uint8Array) {
      if (stopped || failed) return;
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 160000) {
        fallback("Live stream backpressure; switching to buffered Gemini clips"); return;
      }
      const now = Date.now();
      // An idle capture has nothing to acknowledge. Give resumed audio a full
      // acknowledgment window rather than failing it before the first reply.
      if (lastSent === undefined || now - lastSent > 4000) lastReply = now;
      lastSent = now;
      socket.send(bytes);
    },
    endTurn() { if (!stopped && !failed && socket?.readyState === WebSocket.OPEN) socket.send('{"endTurn":true}'); },
    stop() {
      stopped = true; abort.abort(); clearInterval(watchdog); socket?.close();
      if (opened) void fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop: true, source: options.source, roundNumber: options.roundNumber }) }).catch(() => {});
    },
  };
}
