const path = require('node:path');
const { runtimeFiles } = require('./runtime-files.cjs');
const { verifyPackedRuntime } = require('./verify-runtime.cjs');
const { azureTrustedSigning } = require('./signing.cjs');
const azure = azureTrustedSigning();
module.exports = {
  appId: 'com.sonora.assistant',
  productName: 'Sonora AI',
  electronVersion: require('electron/package.json').version,
  compression: 'maximum',
  directories: { output: path.resolve(__dirname, '../../../generated-artifacts/installers'), buildResources: path.resolve(__dirname, '../../../generated-artifacts/desktop-app/assets') },
  files: [...runtimeFiles, 'runtime-config.json', 'assets/**', 'package.json', 'THIRD_PARTY_NOTICES.txt', 'offline.html', 'updater-runtime.cjs'],
  afterPack: verifyPackedRuntime,
  extraResources: [{ from: path.resolve(__dirname, '../../../generated-artifacts/desktop-app/native'), to: 'native' }],
  asar: true,
  artifactName: 'Sonora-${version}-${os}-${arch}.${ext}',
  forceCodeSigning: false,
  // GitHub Releases is the publish target. Local and Replit builds pass --publish never.
  publish: { provider: 'github', owner: 'kriksh10', repo: 'Sonora', releaseType: 'release' },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.productivity',
    minimumSystemVersion: '14.4',
    hardenedRuntime: true,
    entitlements: path.join(__dirname, 'entitlements.mac.plist'),
    entitlementsInherit: path.join(__dirname, 'entitlements.mac.plist'),
    icon: 'icon.png',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Sonora transcribes your microphone only when you start capture.',
      NSAudioCaptureUsageDescription: 'Sonora transcribes computer audio only after you explicitly share it.',
      NSScreenCaptureUsageDescription: 'Sonora uses screen access only for the legacy development capture path. The packaged native audio helper does not capture screen video.',
    },
  },
  dmg: { sign: false },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'icon.png',
    signAndEditExecutable: true,
    ...(azure ? { azureSignOptions: azure } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    differentialPackage: true,
  },
};
