# Sonora desktop overlay

The desktop shell wraps the existing Sonora web app in a frameless, transparent Electron window.

## Run locally

```bash
pnpm --filter @workspace/sonora-ai run desktop:dev
```

The app starts hidden. Use `Ctrl/Cmd + Shift + Space` or the Sonora tray icon to show and hide it.

## Current scope

The browser workspace is the supported way to test the live assistant. Sign in, create a session, and type a question to test Gemini without granting microphone permission. Browser speech recognition can transcribe microphone input after an explicit start action; it does not capture Zoom, Meet, or Teams system audio.

The Electron shell can display the hosted workspace by setting `SONORA_DESKTOP_URL` to that app's HTTPS URL and running `desktop:run`. The hosted server must remain available for authentication, sessions, and Gemini requests. The development helper starts a local frontend only; it does not start or proxy the API server.

An offline `file://` build is not a supported live assistant and shows an explanatory message instead of fake capture controls. Cross-platform call-audio capture, packaged desktop authentication, and native speech transcription require additional implementation. Native window behavior cannot be fully verified in the headless Replit workspace.