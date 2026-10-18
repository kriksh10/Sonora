const path = require('node:path');
module.exports = {
  appId: 'com.sonora.assistant',
  productName: 'Sonora AI',
  electronVersion: require('electron/package.json').version,
  directories: { output: path.resolve(__dirname, '../../../generated-artifacts/installers'), buildResources: path.resolve(__dirname, '../../../generated-artifacts/desktop-app/assets') },
  files: ['main.cjs', 'preload.cjs', 'security.cjs', 'runtime-config.json', 'assets/**', 'package.json'],
  asar: true,
  artifactName: 'Sonora-${version}-${os}-${arch}.${ext}',
  publish: null,
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.productivity',
    minimumSystemVersion: '14.2',
    hardenedRuntime: true,
    entitlements: path.join(__dirname, 'entitlements.mac.plist'),
    entitlementsInherit: path.join(__dirname, 'entitlements.mac.plist'),
    icon: 'icon.png',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Sonora transcribes your microphone only when you start capture.',
      NSAudioCaptureUsageDescription: 'Sonora transcribes computer audio only after you explicitly share it.',
      NSScreenCaptureUsageDescription: 'Sonora establishes a user-approved system-audio stream. Screen video is not sent to the server.',
    },
  },
  dmg: { sign: false },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'icon.png',
    signAndEditExecutable: true,
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true },
};
