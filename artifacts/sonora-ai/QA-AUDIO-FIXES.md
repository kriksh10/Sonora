# Audio and session QA fixes

## Implemented

- Browser audio emits independent 5–6 second mono 16kHz PCM WAV clips with
  consistent MIME/headers. Silence and quiet-speech checks remain in place.
- Gemini is instructed to transcribe verbatim rather than answer the recording.
  Near-silence is rejected before calling the model. Non-transcript labels and
  repeated greeting-only output are filtered.
- Busy transcription requests skip a clip and continue capture. A bounded queue
  skips older queued clips with a notice rather than stopping the microphone.
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
