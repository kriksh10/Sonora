# Sonora desktop overlay

The desktop shell wraps the existing Sonora web app in a frameless, transparent Electron window.

## Run locally

```bash
pnpm --filter @workspace/sonora-ai run desktop:dev
```

The app starts hidden. Use `Ctrl/Cmd + Shift + Space` or the Sonora tray icon to show and hide it.

## Current scope

The overlay shell is ready for the recording and assistant UI, but it does not yet capture call audio or provide production AI inference. Those capabilities require platform-specific audio permissions and a connected transcription/AI service.