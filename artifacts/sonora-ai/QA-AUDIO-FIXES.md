# Audio and session QA fixes

## Implemented

- Browser audio emits independent 5–6 second mono 16kHz PCM WAV clips with
  consistent MIME/headers. Silence and quiet-speech checks remain in place.
- Gemini is instructed to transcribe verbatim rather than answer the recording.
  Near-silence is rejected before calling the model. Non-transcript labels and
  repeated greeting-only output are filtered.
- Busy transcription requests retain the clip for up to two retries and continue
  capture. A bounded queue holds up to twelve waiting clips and records any
  discarded clip, skipped request or cancellation in session diagnostics.
  Busy availability probes do not silently switch to browser speech recognition.
- Startup is cancellable while waiting for the probe. WebAudio is activated
  during the user gesture; worklet/resume operations are bounded. A compatibility
  PCM processor is used if the worklet cannot load. It explicitly produces
  silent output, never microphone playback.
- Meeting/tab audio can trigger Auto Answer without the optional speaker-label
  mapping checkbox. Microphone questions have a separate explicit opt-in.
  Mixed microphone speech is not falsely assigned interviewer identity.
  New sessions default Auto Answer on; existing settings are preserved.
- Chat shows returned replies and stays in the workspace. Screenshot displays
  results or visible errors. Clear suppresses history fallback so the visible
  answer actually clears, without deleting the saved transcript.
  Ended sessions disable live tools with an explanation.
- Existing pricing, settings, privacy and terms routes are registered and
  reachable. Settings retains the theme control. Auth is resolved before
  rendering route content, preventing signed-out-preview flashes.
- The public catalog reports test-checkout capability without credentials.
  Pricing buttons display Coming soon without test configuration. Live Stripe
  keys remain rejected; checkout remains approval-gated.

## Verified

- Full workspace typecheck and build pass. Existing bundle-size warning remains.
- 35 targeted regression checks passed across the relevant runs, including
  WAV validation, queue pressure, 429 probes/clips, compatibility capture,
  source routing, phone mode, quiet speech, packaging and server integration.
- A generated spoken-English fixture asked:
  “Can you explain the difference between a process and a thread?
  When would you use each one?”
  The actual Replit Gemini integration returned those words correctly.
- The same speech passed through the compatibility PCM collector, WAV encoder
  and actual Gemini service and returned both questions correctly.
- A silent WAV returned empty text.
- Browser QA confirmed the new Auto Answer default and a visible Chat reply.
  It found and prompted the fix for Clear's saved-history fallback.
- Public route requests for pricing/privacy/terms/settings returned 200;
  an unknown document returned 404. Public catalog showed Daily pass and
  checkout false. A 390px pricing screenshot rendered correctly.

## Verification limits

Browser audio attempts exposed a stalled AudioWorklet module load. A bounded,
unit-tested compatibility path was subsequently added and tested with actual
spoken audio through the real provider. That final compatibility path has not
yet completed a 90-second browser end-to-end run with automatic answers.

Screenshot capture/analysis and ended-session button behavior were implemented
but not completed in the browser pass, which stopped at the audio startup
blocker. Physical Windows microphone, meeting/tab and native desktop-device
behavior were not established by these Linux/provider checks.

Nothing was published. No installer or production database was changed.

## Installed Windows capture continuity

The actual `/download` installer (`Sonora-0.3.5-win-x64.exe`) was unpacked,
including its own `resources/app.asar` and native helper. Its preload and main
bridge expose native capture and PCM events; the Windows Rust helper contains
the PCM event protocol. A separately uploaded same-version app.asar was not
identical and was not used as the sole compatibility evidence.

Previously, the hosted client selected native helper capture when that bridge
was present. It sent small PCM frames to the separate live Speechmatics service
and suppressed Gemini WAV requests once live recognition became active.
The live frame backlog silently evicted frames beyond its buffer limit.
Legacy WAV fallback had no boundary overlap and could produce short clips.
Thus the earlier server-Gemini fixes did not establish good desktop recognition.

The new hosted path is:

    Windows native microphone/WASAPI loopback
      → native PCM events → Electron IPC/preload
      → renderer's continuous 16kHz mono accumulator
      → six-second WAV requests every 5.25 seconds (750ms overlap)
      → POST /api/sessions/:id/transcribe → Replit Gemini
      → adjacent-clip suffix/prefix de-duplication → question/answer UI

Capture is never stopped/restarted at window boundaries. Legacy native WAV or
browser capture also prepends a 750ms boundary tail, remaining below the
eight-second server limit. The standard desktop adapter no longer calls the
live-audio/Speechmatics endpoint; those server routes are preserved.
De-duplication only applies to adjacent successfully transcribed overlapping
clips, not across a skipped clip or unrelated question. Removal is limited to a
short boundary of at most six words so a genuinely repeated long question is
not erased.

The expandable Capture diagnostics log records source, timestamps, clip number,
duration, queue depth, selected path, submission, retry, completion and all
discard/skip reasons. It caches the last120 metadata-only events per interview
round in browser session storage. It never stores audio or recognized text.
The UI explicitly notes that Stop or sustained provider failure can discard
unfinished/queued audio; arbitrary failure cannot be guaranteed lossless.

No packaged files were changed. The existing0.3.5 bridge already supplies the
required continuous PCM, so an installer0.3.6 rebuild is not required for this
renderer fix and no download/version/checksum was falsely replaced.
Existing installations receive the new adapter only after the hosted site is
published and reloaded. Nothing was published during this work.

Focused verification:18 capture/continuity tests pass, including native PCM
routing exclusively to Gemini, exact sample continuity/750ms overlap,
independently decodable WAVs, boundary text de-duplication, busy-request retry,
queue pressure, compatibility capture and stop cancellation. Full workspace
typecheck and build pass. These do not establish physical Windows device
behavior.

One focused native-bridge browser pass also succeeded:4,500 real fixture PCM
frames at20ms cadence,92.7s elapsed,17 completed clips and18 POST attempts
including one injected429. The retried clip completed while capture stayed
active, there were no live-audio requests, actual Gemini recognized the known
process/thread question, and an automatic answer became ready. Diagnostics
expanded and showed overlap removal with zero dropped/skipped events during
the sustained capture. The repeated fixture questions were natural loop
repetitions, not artificial boundary duplication.

The test used an in-memory Electron bridge transport stub, not a physical
Windows device. A later HMR/stub-contract interruption during transcript
inspection was recovered by adding missing bridge methods to the test stub;
no production code or installer was changed for that interruption. Physical
device selection, recording level and Windows helper execution still require
Windows hardware validation.
