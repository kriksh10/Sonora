const { randomBytes, createHash } = require('node:crypto');

function createBrowserAuth({ serviceUrl, openExternal, fetcher = fetch, clock = Date.now }) {
  let request;
  let generation = 0;
  let polling = false;
  const origin = new URL(serviceUrl).origin;
  async function api(path, body) {
    const response = await fetcher(new URL(`/api/desktop-auth/requests${path}`, origin), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) throw new Error('Publish the latest Sonora service before using browser sign-in.');
      throw new Error(value.error || `Desktop sign-in request failed (${response.status}).`);
    }
    return value;
  }
  async function cancel(expectedId) {
    // A stale renderer cannot cancel a newer request.
    if (expectedId && request?.id !== expectedId) return;
    generation++;
    const old = request;
    request = undefined;
    if (old) await api(`/${old.id}/cancel`, { verifier: old.verifier }).catch(() => {});
  }
  return {
    async start() {
      const current = ++generation;
      const old = request;
      request = undefined;
      if (old) void api(`/${old.id}/cancel`, { verifier: old.verifier }).catch(() => {});
      const verifier = randomBytes(32).toString('hex');
      const challenge = createHash('sha256').update(verifier).digest('hex');
      const result = await api('', { challenge });
      if (current !== generation) {
        if (typeof result.id === 'string') void api(`/${result.id}/cancel`, { verifier }).catch(() => {});
        throw new Error('Desktop sign-in was cancelled.');
      }
      if (!/^[0-9a-f-]{36}$/i.test(result.id) || !/^\d{6}$/.test(result.code) ||
          !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= clock()) {
        throw new Error('The service returned an invalid desktop sign-in request.');
      }
      request = { ...result, verifier };
      try {
        // Only the request id goes into the URL. Proof, code and tickets never do.
        await openExternal(new URL(`/desktop-connect/${result.id}`, origin).href);
      } catch {
        await cancel(result.id);
        throw new Error('Could not open your browser. Check your default browser and try again.');
      }
      if (current !== generation) throw new Error('Desktop sign-in was cancelled.');
      return { id: result.id, code: result.code, expiresAt: result.expiresAt };
    },
    async poll(expectedId) {
      if (typeof expectedId !== 'string' || request?.id !== expectedId) throw new Error('Start a new desktop sign-in request.');
      if (Date.parse(request.expiresAt) <= clock()) {
        await cancel(expectedId); throw new Error('Desktop sign-in expired. Start again.');
      }
      if (polling) return { status: 'pending' };
      polling = true;
      const pending = request, current = generation;
      try {
        const result = await api(`/${pending.id}/poll`, { verifier: pending.verifier });
        if (current !== generation || request?.id !== pending.id) throw new Error('Desktop sign-in was cancelled.');
        if (result.status === 'complete' && typeof result.ticket === 'string' && result.ticket) {
          request = undefined;
          return { status: 'complete', ticket: result.ticket };
        }
        if (result.status !== 'pending') throw new Error('The service returned an invalid sign-in result.');
        return { status: 'pending' };
      } finally { polling = false; }
    },
    cancel,
  };
}
module.exports = { createBrowserAuth };
