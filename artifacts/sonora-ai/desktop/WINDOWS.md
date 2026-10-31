# Build Sonora on Windows

### Output routing in 0.3.3

After rebuilding and installing, choose Call audio (or Both) in the live session.
Use **Meeting output** to select the exact speaker/headset configured in Google Meet's
Settings → Audio → Speakers. Click Refresh devices after connecting a headset.
The selection changes capture only; it does not change Windows or Meet playback settings.
Stop audio before changing it, confirm interviewer mapping, enable Auto Answer, then Start audio.
Use Readiness to check activity on the same selected endpoint. Its fixed Gemini test checks
provider connectivity separately, not the complete meeting-audio-to-answer path.

If Meeting output selection is unavailable, the installed shell is older: it captures
Windows default output only. Rebuild/reinstall to obtain device selection; republishing
the website alone cannot add this native capability.

This page is a local build guide. A local `BUILD-WINDOWS.cmd` run does not sign the installer or upload it. The published download is the GitHub Release described in [README.md](README.md).

## What you need

- A Windows x64 computer; Windows 11 is recommended. Windows ARM is not supported.
- A published HTTPS Sonora service. The app still uses the hosted sign-in, database, Gemini transcription, and Gemini answers. It is not an offline AI app. Never put a Gemini API key into the installer.
- Internet access and enough disk space for Node dependencies, Rust, Visual Studio tools, and build outputs.
- Node.js 22+ from https://nodejs.org/
- pnpm 10.26.1: after installing Node, run `npm install --global pnpm@10.26.1`.
- Git for Windows from https://git-scm.com/downloads/win — needed by the source dependency tooling, **not** for GitHub authentication. Dependencies may be downloaded from public source hosts.
- Stable Rust 1.88+ from https://rustup.rs/ using the default Windows MSVC toolchain.
- Visual Studio Build Tools 2022 from https://visualstudio.microsoft.com/visual-cpp-build-tools/ with **Desktop development with C++**, the **MSVC x64/x86 build tools**, and a **Windows 10 or 11 SDK** selected.

These are developer tools for the computer creating the installer. People installing the finished app do not need Node, Rust, pnpm, or Visual Studio.

## Get the source without GitHub

Use the **latest Sonora desktop build kit (0.3.2)** provided with the update. Extract it and read `START-HERE.md`. It is a small source archive, not an installer, and excludes user uploads, credentials, and dependency caches. Republish the updated hosted service first: the builder checks browser sign-in, separate-channel audio and streaming-answer protocol support before downloading dependencies.

In Replit, open the three-dot menu at the top of the file tree and choose **Download as zip**. Extract it into a writable local folder, for example `Documents\Sonora`. Do not run the launcher inside the ZIP.

Do not transfer `.env` files, credentials, databases, audio recordings, or dependency caches. They are not needed for a desktop build. If the export includes `node_modules`, remove that generated folder before installing Windows dependencies; Linux dependencies cannot be reused as Windows binaries.

## Build

1. Publish Sonora and obtain its real HTTPS service address. A `.replit.dev` preview address is deliberately rejected.
2. Reopen your terminal after installing the developer tools so their PATH entries are active.
3. Double-click **BUILD-WINDOWS.cmd** in the extracted project root.
4. If prerequisites are missing, the launcher lists them and stops without installing anything.
5. Enter the published Sonora address when asked. The launcher checks that it is a healthy Sonora service.
6. Approve downloading build dependencies. The launcher installs the locked dependencies, runs desktop and Rust checks, compiles the native audio helper, builds the NSIS installer, and creates checksums. Any failed command stops the process.

The installer appears under **generated-artifacts\installers\Sonora-0.3.2-win-x64.exe**, alongside **SHA256SUMS.txt**. Later app versions change the filename.

The launcher does not publish files, run the installer, open the app, capture audio, or disable Windows security. Without configured signing credentials, the installer is unsigned and Windows may show security warnings. Verify its source and checksum; do not turn off SmartScreen or antivirus protections.

## Verify before distributing

### Visibility controls

The installed app has a **Hide Sonora** button above every hosted page, including sign-in. Restore it through the Sonora system tray icon → **Show Sonora**, or **Ctrl+Shift+Space**. If the shortcut cannot register, the app reports this and the tray remains the restore path. Closing the window also hides it; use tray → **Quit Sonora and stop audio** to exit fully.

The separate **Hide from screen sharing** switch keeps Sonora visible locally and requests native capture exclusion. The tray has a matching checkbox. The two controls reflect the same native state; the switch indicates a request, not verified invisibility. Protection starts enabled at launch; changes apply to the current app session. Actual results depend on Windows and the sharing software. Check the receiver's screen before relying on it.

Hiding does not stop active audio. The app displays this warning while capturing, and the tray keeps capture status and **Stop audio capture** available.

Republishing updates the hosted controls, but adding the matching native tray checkbox requires rebuilding and reinstalling the Windows app from the updated source using **BUILD-WINDOWS.cmd**. An old installer does not acquire native code changes just by republishing.

- Install, launch, uninstall, and reinstall using a normal Windows account.
- Sign in, create a session, and confirm a real typed Gemini answer.
- Explicitly start microphone capture, then computer-audio capture with headphones; confirm actual speech becomes a transcript and suggestion.
- Confirm denied permissions, disconnected devices, service errors, and silence show truthful states.
- Check Both with one source idle for more than a minute: a quiet call channel must not stop the microphone. A short remote question followed by silence must still reach transcription. Confirm source mapping and enable Auto Answer explicitly; microphone/Unknown speech must not trigger answers.
- Use Readiness before the call; its Start/Stop and closing release devices, activity is source-specific, and the Gemini test produces a real answer without saving test history. Reopen the live view and start session audio separately.
- Confirm streamed answers remain readable, transcript starts collapsed, follow/pause/Jump works, and Shorten/Explain more/Answer again use the same question. Test cancel, offline, retry and End during generation without stale output.
- Open Window settings → About, diagnostics & updates. Check version 0.3.2, inspect/export the allowlisted report, and confirm unavailable installers do not produce a download button.
- Test background opacity over both a light and dark desktop: drag the slider quickly, use arrow keys, test 15%, 50%, 100% and Use opaque background. The thumb and background must respond without moving the window or fading answer text; settings intentionally stay opaque. Restart to check the saved value. Move the app using the Sonora handle, not the slider. An older shell shows either its 45% limit or explicit rebuild guidance, not an unexplained disabled control.
- Stop capture, end/switch sessions, sign out, hide/show, use tray Stop, and Quit; verify capture actually releases.
- Check the receiver's view during both window and whole-screen sharing in the meeting software you intend to use. Capture exclusion is best-effort, not universal invisibility.

Only after those checks should this become an advertised download. You can copy the installer directly to another Windows PC or host it on the download page; GitHub is not required for either.
