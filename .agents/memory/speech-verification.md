---
name: Speech capture verification
description: Verify recognized words and silence separately; provider connectivity alone does not establish working interview audio.
---

Use a known spoken question and a silent sample as separate acceptance checks for transcription. Verify both the words and downstream automatic answers, not merely HTTP success.

**Why:** A successful request with silent audio did not establish useful transcription; the user later reported repeated greeting filler instead of the actual interview questions.

**How to apply:** Compare actual recognized content with the fixture, assert empty text for silence, and distinguish provider checks, injected browser audio and physical device tests. Exercise busy responses on both the availability probe and actual audio requests: a busy service must not silently select a different capture pipeline.

For browser mocks, verify the source audio context is running, not just that the track says live. Diagnose each startup stage independently: a successful STT probe does not establish that the browser's worklet loaded or that any PCM was captured.

**Why:** Preview QA observed a pending worklet-module load without a rejected promise or browser exception, even while the mock source was running and the Gemini provider correctly transcribed the fixture.
