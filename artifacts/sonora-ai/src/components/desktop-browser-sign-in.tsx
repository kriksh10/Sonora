import { useCallback, useEffect, useRef, useState } from 'react';
import { RedirectToTasks, useClerk } from '@clerk/react';
import { Globe, Loader2, X } from 'lucide-react';

type Started = { id: string; code: string; expiresAt: string };
type Poll = { status: 'pending' } | { status: 'complete'; ticket: string };
type BrowserBridge = {
  startBrowserSignIn?: () => Promise<Started>;
  pollBrowserSignIn?: (id: string) => Promise<Poll>;
  cancelBrowserSignIn?: (id: string) => Promise<unknown>;
};

type Phase = 'idle' | 'starting' | 'waiting' | 'finishing' | 'tasks' | 'error';

const POLL_MS = 2000;

function bridge(): BrowserBridge | undefined {
  return (window as unknown as { sonoraDesktop?: BrowserBridge }).sonoraDesktop;
}

export default function DesktopBrowserSignIn() {
  const clerk = useClerk();
  const clerkRef = useRef(clerk);
  clerkRef.current = clerk;
  const [phase, setPhase] = useState<Phase>('idle');
  const [request, setRequest] = useState<Started | null>(null);
  const [message, setMessage] = useState('');
  const [remaining, setRemaining] = useState(0);
  const generation = useRef(0);
  const ownedId = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const b = bridge();
  const supported = !!(b?.startBrowserSignIn && b.pollBrowserSignIn && b.cancelBrowserSignIn);

  const stopTimer = () => { window.clearTimeout(timer.current); timer.current = undefined; };

  const cancelOwned = useCallback(() => {
    const id = ownedId.current;
    ownedId.current = null;
    if (id) void Promise.resolve(bridge()?.cancelBrowserSignIn?.(id)).catch(() => undefined);
  }, []);

  const invalidate = useCallback(() => { generation.current += 1; stopTimer(); }, []);

  useEffect(() => () => { invalidate(); cancelOwned(); }, [invalidate, cancelOwned]);

  useEffect(() => {
    if (phase !== 'waiting' || !request) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((Date.parse(request.expiresAt) - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        invalidate();
        cancelOwned();
        setMessage('The code expired. Start again to get a new one.');
        setPhase('error');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, request, invalidate, cancelOwned]);

  const finish = async (gen: number, ticket: string) => {
    setPhase('finishing');
    try {
      if (!clerkRef.current.client) throw new Error('Sign-in is still loading.');
      const result = await clerkRef.current.client.signIn.create({ strategy: 'ticket', ticket });
      if (gen !== generation.current) return;
      if (result.status !== 'complete' || !result.createdSessionId) {
        setMessage('Sign-in needs another verification step. Complete your account verification in the browser, then start a new desktop request.');
        setPhase('error');
        return;
      }
      await clerkRef.current.setActive({ session: result.createdSessionId });
      if (gen !== generation.current) return;
      const session = clerkRef.current.session;
      if (session && (session as { currentTask?: unknown }).currentTask) setPhase('tasks');
      else setPhase('idle');
    } catch {
      if (gen !== generation.current) return;
      setMessage('Browser sign-in could not be completed. Complete any account verification in your browser, then start again.');
      setPhase('error');
    }
  };

  const poll = (gen: number, id: string) => {
    timer.current = window.setTimeout(async () => {
      if (gen !== generation.current) return;
      try {
        const res = await bridge()!.pollBrowserSignIn!(id);
        if (gen !== generation.current) return;
        if (res.status === 'complete' && typeof res.ticket === 'string') {
          ownedId.current = null;
          await finish(gen, res.ticket);
          return;
        }
        poll(gen, id);
      } catch (cause) {
        if (gen !== generation.current) return;
        invalidate();
        cancelOwned();
        setMessage(cause instanceof Error ? cause.message : 'Lost contact with browser sign-in. Try again.');
        setPhase('error');
      }
    }, POLL_MS);
  };

  const start = async () => {
    if (phase === 'starting' || phase === 'waiting' || phase === 'finishing') return;
    const fn = bridge()?.startBrowserSignIn;
    if (!fn) return;
    invalidate();
    cancelOwned();
    const gen = generation.current;
    setPhase('starting');
    setMessage('');
    try {
      const started = await fn();
      if (gen !== generation.current) {
        // superseded or unmounted while starting: release this orphan request
        void Promise.resolve(bridge()?.cancelBrowserSignIn?.(started.id)).catch(() => undefined);
        return;
      }
      ownedId.current = started.id;
      setRequest(started);
      setPhase('waiting');
      poll(gen, started.id);
    } catch (cause) {
      if (gen !== generation.current) return;
      setMessage(cause instanceof Error ? cause.message : 'Your browser could not be opened. Try again.');
      setPhase('error');
    }
  };

  const cancel = () => {
    invalidate();
    cancelOwned();
    setRequest(null);
    setPhase('idle');
  };

  if (!supported) {
    return (
      <p role="alert" className="max-w-sm rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100" data-testid="text-browser-signin-unsupported">
        This installer needs an update before it can sign in through your browser. Install the latest Sonora desktop app. You can use Sonora in your regular browser in the meantime.
      </p>
    );
  }

  const busy = phase === 'starting' || phase === 'finishing';
  const mm = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  return (
    <section aria-label="Sign in with your browser" className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#17181b] p-5 text-white">
      {phase === 'waiting' && request ? (
        <div>
          <p className="text-sm text-white/65">Your browser is open. Sign in there, then enter this code when asked:</p>
          <p className="my-4 text-center font-mono text-4xl tracking-[.3em]" aria-label={`Code ${request.code.split('').join(' ')}`} data-testid="text-browser-signin-code">{request.code}</p>
          <p role="timer" className="text-center text-xs text-white/55" data-testid="text-browser-signin-countdown">Expires in {mm}</p>
          <p className="mt-3 text-xs leading-5 text-white/55">Approving in the browser does not finish sign-in until this app confirms.</p>
          <button type="button" onClick={cancel} data-testid="button-browser-signin-cancel"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
            <X size={15} /> Cancel
          </button>
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => void start()} disabled={busy} data-testid="button-browser-signin-start"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#257c3c] px-4 py-3 text-sm font-semibold hover:bg-[#2c9147] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
            {phase === 'finishing' ? 'Finishing sign-in…' : phase === 'starting' ? 'Opening browser…' : phase === 'error' ? 'Try again in browser' : 'Continue in browser'}
          </button>
          <p className="mt-3 text-xs leading-5 text-white/55">Opens your default browser so Google and other providers work normally.</p>
        </div>
      )}
      {phase === 'error' && <p role="alert" className="mt-3 text-sm text-red-300" data-testid="text-browser-signin-error">{message}</p>}
      {phase === 'tasks' && (
        <div role="status" className="mt-3 text-sm text-amber-100" data-testid="text-browser-signin-tasks">
          Your account needs one more step before you can continue. Follow the prompts that appear.
          <RedirectToTasks />
        </div>
      )}
    </section>
  );
}
