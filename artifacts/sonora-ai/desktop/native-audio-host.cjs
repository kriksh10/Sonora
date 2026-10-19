const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

function validWav(value) {
  if (typeof value !== 'string' || value.length > 260000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const wav = Buffer.from(value, 'base64');
  return wav.length === 192044 && wav.toString('ascii', 0, 4) === 'RIFF' &&
    wav.toString('ascii', 8, 16) === 'WAVEfmt ' && wav.readUInt32LE(4) === wav.length - 8 &&
    wav.readUInt32LE(16) === 16 && wav.readUInt16LE(20) === 1 &&
    wav.readUInt16LE(22) === 1 && wav.readUInt32LE(24) === 16000 &&
    wav.readUInt32LE(28) === 32000 && wav.readUInt16LE(32) === 2 &&
    wav.readUInt16LE(34) === 16 && wav.toString('ascii', 36, 40) === 'data' &&
    wav.readUInt32LE(40) === wav.length - 44;
}

/** Only the main process owns the executable path, consent, process and audio lease. */
function createNativeAudioHost({ binary, confirm, emit, onActive, spawnProcess = spawn, checkBinary = fs.accessSync }) {
  let current = null;
  let consentBusy = false;
  function stop(id) {
    const record = current;
    if (!record || (id && record.id !== id)) return false;
    record.cancelled = true;
    record.reject?.(new Error('Audio capture cancelled.'));
    if (!record.child) {
      current = null;
      onActive(false);
      return true;
    }
    clearTimeout(record.startTimer);
    clearTimeout(record.watchdog);
    try { record.child.stdin.end('stop\n'); } catch { record.child.kill(); }
    record.killTimer = setTimeout(() => record.child.kill('SIGKILL'), 1500);
    record.killTimer.unref?.();
    return true;
  }
  function shutdown() {
    stop();
    current?.child?.kill('SIGKILL');
  }
  async function start(id, source) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) ||
        !['microphone', 'system'].includes(source)) throw new Error('Invalid native audio request.');
    if (current || consentBusy) throw new Error('Audio is already starting, active, or stopping.');
    const record = { id, cancelled: false, ready: false };
    current = record;
    consentBusy = true;
    let allowed;
    try { allowed = await confirm(source); }
    catch { allowed = false; }
    finally { consentBusy = false; }
    if (current !== record || record.cancelled) throw new Error('Audio capture cancelled.');
    if (!allowed) { current = null; throw new Error('Audio permission was not granted.'); }
    try { checkBinary(binary, fs.constants.X_OK); }
    catch { current = null; throw new Error('This build is missing its native audio helper. Install a complete desktop release.'); }
    return new Promise((resolve, reject) => {
      record.reject = reject;
      const send = event => emit({ ...event, captureId: id });
      const fail = message => {
        if (record.cancelled || current !== record) return;
        if (record.ready) send({ type: 'error', message });
        else reject(new Error(message));
        stop(id);
      };
      const watchdog = () => {
        clearTimeout(record.watchdog);
        record.watchdog = setTimeout(() => fail('Native audio stopped responding. Check OS audio permission and retry.'), 20000);
        record.watchdog.unref?.();
      };
      try {
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
          ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA'].includes(key)));
        record.child = spawnProcess(binary, ['--source', source], {
          stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true, env,
        });
        record.child.stdin.on('error', () => fail('Native audio control pipe closed.'));
        record.child.stdout.on('error', () => fail('Native audio stream closed.'));
        const decoder = new StringDecoder('utf8');
        let buffer = '';
        record.child.stdout.on('data', data => {
          if (record.cancelled || current !== record) return;
          buffer += decoder.write(data);
          let newline;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            if (newline > 300000) { fail('Native audio returned an oversized message.'); return; }
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            let event;
            try { event = JSON.parse(line); } catch { fail('Native audio returned an invalid message.'); return; }
            if (!event || typeof event !== 'object' || Array.isArray(event)) {
              fail('Native audio returned an invalid message.'); return;
            }
            if (event.type === 'ready' && event.protocol === 1 && !record.ready) {
              record.ready = true;
              clearTimeout(record.startTimer);
              onActive(true);
              watchdog();
              resolve({ captureId: id });
            } else if (event.type === 'audio' && record.ready && validWav(event.audio)) {
              watchdog();
              send({ type: 'audio', audio: event.audio });
            } else if (event.type === 'silence' && record.ready && typeof event.prolonged === 'boolean') {
              watchdog();
              send({ type: 'silence', prolonged: event.prolonged });
            } else if (event.type === 'error' && typeof event.message === 'string') {
              fail(event.message.slice(0, 300));
            } else if (event.type === 'stopped') {
              fail('Native audio capture ended.');
            } else { fail('Native audio protocol validation failed.'); }
            if (record.cancelled) return;
          }
          if (buffer.length > 300000) fail('Native audio returned an oversized message.');
        });
        record.child.on('error', () => fail('The native audio helper could not start. Reinstall Sonora or check OS security settings.'));
        record.child.on('close', () => {
          clearTimeout(record.killTimer);
          clearTimeout(record.startTimer);
          clearTimeout(record.watchdog);
          if (current === record) {
            current = null;
            onActive(false);
            if (!record.cancelled) {
              if (record.ready) send({ type: 'error', message: 'The native audio helper exited. Restart capture.' });
              else reject(new Error('Native audio exited before becoming ready. Check OS audio permission.'));
            }
          }
        });
        record.startTimer = setTimeout(() => fail('Native audio permission or startup timed out. Check OS settings and retry.'), 45000);
        record.startTimer.unref?.();
      } catch {
        current = null;
        onActive(false);
        reject(new Error('The native audio helper could not start.'));
      }
    });
  }
  return { start, stop, shutdown, isActive: () => Boolean(current?.ready) };
}
module.exports = { createNativeAudioHost, validWav };
