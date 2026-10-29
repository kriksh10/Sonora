import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { SignIn, useAuth, useUser } from '@clerk/react';
import { Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';

type Status = 'pending' | 'approved' | 'exchanging' | 'consumed' | 'cancelled';
type RequestState = { status: Status; expiresAt: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_MS = 3000;
const MAX_POLLS = 200;

const shell = 'flex min-h-[100dvh] items-center justify-center bg-[#101113] px-4 py-8 text-white';
const card = 'w-full max-w-md rounded-2xl border border-white/10 bg-[#17181b] p-6';

export default function DesktopConnect({ params }: { params: { id: string } }) {
  const id = params.id;
  const valid = UUID.test(id);
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [state, setState] = useState<RequestState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [approved, setApproved] = useState(false);
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const submitAbort = useRef<AbortController | null>(null);

  const path = `/api/desktop-auth/requests/${id}`;
  const signedIn = isLoaded && !!isSignedIn;
  const status = state?.status;
  const terminal = expired || status === 'consumed' || status === 'cancelled';

  useEffect(() => {
    if (!valid || !signedIn || terminal) return;
    let live = true;
    let count = 0;
    let t: number | undefined;
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch(path, { credentials: 'include',
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]), headers: { Accept: 'application/json' } });
        if (!live) return;
        if (res.status === 404 || res.status === 410) { setExpired(true); return; }
        if (!res.ok) throw new Error();
        const body = (await res.json()) as RequestState;
        if (!live) return;
        setState(body);
        setLoadError('');
        if (Date.parse(body.expiresAt) <= Date.now() && body.status === 'pending') { setExpired(true); return; }
        if (body.status === 'consumed' || body.status === 'cancelled') return;
      } catch {
        if (!live || ctrl.signal.aborted) return;
        setLoadError('We could not check this request.');
        return;
      }
      if (++count >= MAX_POLLS) { setLoadError('Stopped checking for updates.'); return; }
      t = window.setTimeout(() => void run(), POLL_MS);
    };
    void run();
    return () => { live = false; ctrl.abort(); window.clearTimeout(t); };
  }, [valid, signedIn, path, terminal, attempt]);

  useEffect(() => () => submitAbort.current?.abort(), []);

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !/^[0-9]{6}$/.test(code)) return;
    submitAbort.current?.abort();
    const ctrl = new AbortController();
    submitAbort.current = ctrl;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`${path}/approve`, {
        method: 'POST', credentials: 'include', signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (ctrl.signal.aborted) return;
      if (!res.ok) {
        setSubmitError(res.status === 404 || res.status === 410 ? 'This request expired or was cancelled. Start again in Sonora.'
          : res.status === 401 ? 'Your browser session ended. Reload and sign in again.'
          : 'That code was not accepted. Check the code shown in Sonora and try again.');
        return;
      }
      setApproved(true);
      setAttempt(a => a + 1);
    } catch {
      if (!ctrl.signal.aborted) setSubmitError('Could not reach Sonora. Check your connection and try again.');
    } finally {
      if (!ctrl.signal.aborted) setSubmitting(false);
    }
  }, [code, path, submitting]);

  if (!valid) return <Msg title="Invalid link" body="This approval link is not valid. Start sign-in again from the Sonora desktop app." />;
  if (!isLoaded) return <div className={shell} role="status" aria-label="Loading"><Loader2 className="animate-spin text-white/50" /></div>;

  if (!isSignedIn) {
    const here = window.location.pathname;
    return (
      <div className={shell}>
        <div className="flex flex-col items-center gap-4">
          <p className="max-w-sm text-center text-sm text-white/60">Sign in to approve the Sonora desktop app. You will enter a code from the app next.</p>
          <SignIn routing="hash" forceRedirectUrl={here} signUpForceRedirectUrl={here} />
        </div>
      </div>
    );
  }

  if (expired) return <Msg title="Request expired" body="This sign-in request is no longer valid. Start again from the Sonora desktop app." />;
  if (status === 'cancelled') return <Msg title="Request cancelled" body="Sign-in was cancelled in the desktop app. Nothing was approved." />;
  if (status === 'consumed') return <Msg ok title="Desktop signed in" body="Sonora confirmed this sign-in. You can close this tab and return to the app." />;
  if (approved || status === 'approved' || status === 'exchanging') {
    return <Msg ok title="Approved. Return to Sonora" body="Approval is not the same as signing in. Your desktop app still has to confirm, which should take a few seconds. You can close this tab once it does." live />;
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? 'your account';
  return (
    <main className={shell}>
      <section className={card} aria-labelledby="dc-title">
        <h1 id="dc-title" className="text-lg font-semibold">Approve Sonora desktop</h1>
        <p className="mt-3 text-sm text-white/65">Signed in as <strong className="text-white" data-testid="text-desktop-connect-user">{email}</strong></p>
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <span>Only approve if you just started sign-in in the Sonora desktop app. If you did not, close this page.</span>
        </div>
        {loadError && (
          <div role="alert" className="mt-4 text-sm text-red-300">{loadError}{' '}
            <button type="button" className="underline" onClick={() => { setLoadError(''); setAttempt(a => a + 1); }} data-testid="button-desktop-connect-retry">Retry</button>
          </div>
        )}
        {!state && !loadError && <p className="mt-4 text-sm text-white/50" role="status">Checking request…</p>}
        <form onSubmit={submit} className="mt-5">
          <label htmlFor="dc-code" className="text-sm text-white/80">Six-digit code shown in Sonora</label>
          <input id="dc-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            data-testid="input-desktop-connect-code"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#101113] px-4 py-3 text-center font-mono text-2xl tracking-[.4em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300" />
          {submitError && <p role="alert" className="mt-3 text-sm text-red-300">{submitError}</p>}
          <button type="submit" disabled={submitting || code.length !== 6 || !state} data-testid="button-desktop-connect-approve"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#257c3c] px-4 py-3 text-sm font-semibold hover:bg-[#2c9147] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
            {submitting && <Loader2 size={16} className="animate-spin" />} Approve desktop sign-in
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-white/50">Approving here does not complete sign-in until the desktop app confirms.</p>
      </section>
    </main>
  );
}

function Msg({ title, body, ok, live }: { title: string; body: string; ok?: boolean; live?: boolean }) {
  return (
    <main className={shell}>
      <section className={card} role={live ? 'status' : undefined}>
        {ok && <CheckCircle2 className="mb-3 text-emerald-300" />}
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">{body}</p>
      </section>
    </main>
  );
}
