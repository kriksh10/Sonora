# Real-time transcription

The primary path for both supported desktop bridges and browser mic/meeting
capture is continuous mono16kHz PCM → authenticated Sonora WebSocket →
Speechmatics → partial/final/EOU events → Gemini streamed answer.

Speechmatics uses Standard with partials,0.7s fixed final delay,600ms
end-of-utterance silence detection and the correct object-shaped custom vocabulary.
Provider callbacks are forwarded immediately, even if no more audio arrives.
Local600ms quiet detection can request ForceEndOfUtterance; only stable final
text, not revisable partial text, is used to automatically answer. Mic answering
still requires its opt-in. Meeting-audio answering retains its existing policy.

The question collection stage no longer adds a350ms timer after an already
confirmed utterance. The default gemini-2.5-flash uses zero thinking budget
and a short direct first-sentence instruction. Explicit user model choices
remain unchanged. SSE content is streamed without proxy buffering.

On missing credentials, startup/connection/provider failure, lost acknowledgments
or excessive socket backpressure, the client diagnoses the reason and falls
back to five-to-eight-second Gemini WAVs with750ms overlap. A bounded8s PCM
ring replays audio not covered by provider final timestamps. Queue drops,
retries and Stop cancellations remain visible. Unlimited outage cannot be
lossless; fallback is slower than live recognition. Provider keys stay server-side.

Diagnostics record estimated acoustic question end, signed delay to first live
transcript word (negative = words appeared while the speaker was still talking)
and question-end-to-first-nonempty-answer-text. This last measurement is the
first visible SSE text, not an inaccessible model-internal token timestamp.
Fallback measurements without an acoustic endpoint are labelled transcript-ready,
not question-end latency. Provider processing/network delays vary.

A direct real-provider fixture test recognized:
"Can you explain the difference between a process and a thread?
When would you use each one?"
First transcript appeared3.664s before speech ended; provider utterance-end
arrived1.824s after speech ended. Gemini first text took836ms after its request.
Total measured speech-end-to-first-answer text was3.687s, including setup
between the provider calls. This is a fixture/service measurement, not
physical Windows hardware or an end-to-end browser latency guarantee.

Authenticated app QA subsequently fed the same real spoken fixture through a
simulated desktop bridge into the real Speechmatics and Gemini services:

| Source / path | Question end to first answer text |
| --- | --- |
| System/call, Speechmatics primary |1763ms |
| Mic with explicit mic-answer opt-in, Speechmatics primary |1508ms |
| Mic, forced live-open503 → Gemini fallback |3390ms |

Both live passes produced13 nonempty partials and12 final segments and
recognized the full question. Neither healthy pass posted a Gemini STT clip.
The first call-audio partial appeared3673ms before the last voiced block;
its answer request to first text took721ms. No audio was dropped before Stop.
After the fixture stopped sending frames, a watchdog incorrectly interpreted
idle input as missing acknowledgments; this was fixed and covered by a targeted
idle/resume/real-stall regression test. It does not require an installer change.

These measurements verify the authenticated renderer/server/provider flow,
not an installed Windows helper. A virtual browser-mic attempt ended its track
before worklet output, and a standalone virtual-worklet check timed out; browser
getUserMedia/AudioWorklet runtime and physical Windows permissions remain
unverified. The worklet's continuous20ms raw output is unit-tested.

Installer0.3.5 remains compatible and unchanged. The dialog wording is updated
in source for future packages, not retroactively inside installed executables.
No installer rebuild is required for live PCM streaming. Nothing was published.
