# Build Sonora on Windows

**No GitHub login, repository, Actions, or upload is required.** This is a local build guide, not a downloadable installer or a verified release.

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

In Replit, open the three-dot menu at the top of the file tree and choose **Download as zip**. Extract it into a writable local folder, for example `Documents\Sonora`. Do not run the launcher inside the ZIP.

Do not transfer `.env` files, credentials, databases, audio recordings, or dependency caches. They are not needed for a desktop build. If the export includes `node_modules`, remove that generated folder before installing Windows dependencies; Linux dependencies cannot be reused as Windows binaries.

## Build

1. Publish Sonora and obtain its real HTTPS service address. A `.replit.dev` preview address is deliberately rejected.
2. Reopen your terminal after installing the developer tools so their PATH entries are active.
3. Double-click **BUILD-WINDOWS.cmd** in the extracted project root.
4. If prerequisites are missing, the launcher lists them and stops without installing anything.
5. Enter the published Sonora address when asked. The launcher checks that it is a healthy Sonora service.
6. Approve downloading build dependencies. The launcher installs the locked dependencies, runs desktop and Rust checks, compiles the native audio helper, builds the NSIS installer, and creates checksums. Any failed command stops the process.

The installer appears under **generated-artifacts\installers\Sonora-0.1.0-win-x64.exe** for version 0.1.0, alongside **SHA256SUMS.txt**. Later app versions change the filename.

The launcher does not publish files, run the installer, open the app, capture audio, or disable Windows security. Without configured signing credentials, the installer is unsigned and Windows may show security warnings. Verify its source and checksum; do not turn off SmartScreen or antivirus protections.

## Verify before distributing

- Install, launch, uninstall, and reinstall using a normal Windows account.
- Sign in, create a session, and confirm a real typed Gemini answer.
- Explicitly start microphone capture, then computer-audio capture with headphones; confirm actual speech becomes a transcript and suggestion.
- Confirm denied permissions, disconnected devices, service errors, and silence show truthful states.
- Stop capture, end/switch sessions, sign out, hide/show, use tray Stop, and Quit; verify capture actually releases.
- Check the receiver's view during both window and whole-screen sharing in the meeting software you intend to use. Capture exclusion is best-effort, not universal invisibility.

Only after those checks should this become an advertised download. You can copy the installer directly to another Windows PC or host it on the download page; GitHub is not required for either.
