const { execFile } = require('node:child_process');

function validDeviceName(name) {
  return typeof name === 'string' && name.length > 0 &&
    Buffer.byteLength(name, 'utf8') <= 1024 && !/[\x00-\x1f\x7f]/.test(name);
}

// No shell, arbitrary executable, credentials, or recording. Device names stay local.
function listAudioDevices(binary, source, run = execFile) {
  if (!['microphone', 'system'].includes(source)) return Promise.reject(new Error('Invalid audio source.'));
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA'].includes(key)));
    run(binary, ['--list-devices', source], { timeout: 10000, maxBuffer: 128000, windowsHide: true, shell: false, env },
      (error, stdout) => {
        if (error) { reject(new Error('Could not list audio devices. Install the updated desktop build and retry.')); return; }
        try {
          const result = JSON.parse(stdout);
          if (!Array.isArray(result.devices) || result.devices.length > 100 || !result.devices.every(validDeviceName)) throw new Error();
          resolve([...new Set(result.devices)]);
        } catch { reject(new Error('The audio helper returned an invalid device list.')); }
      });
  });
}
module.exports = { validDeviceName, listAudioDevices };
