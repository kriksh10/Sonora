import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Activity, Check, ChevronDown, CircleStop, Command, Download, FileAudio, Headphones, Menu, Mic, Sparkles, X, Zap } from 'lucide-react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import './sonora-marketing.css';
import HomepageDemo from '@/components/homepage-demo';
import HomepageThemeToggle from '@/components/homepage-theme-toggle';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import InterviewWorkspace from '@/pages/interview-workspace';
import DesktopDownloads from '@/components/desktop-downloads';
import DesktopVisibilityControls from '@/components/desktop-visibility-controls';
import DesktopBrowserSignIn from '@/components/desktop-browser-sign-in';
import DesktopConnect from '@/pages/desktop-connect';
import AccessGate from '@/components/access-gate';
import SettingsPage from '@/pages/settings';
import PricingCatalog from '@/components/pricing-catalog';
import AuthServiceBoundary from '@/components/auth-service-boundary';

const queryClient = new QueryClient();
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function toAppPath(to: string): string {
  let pathname = to;
  let search = '';
  let hash = '';
  try {
    const url = new URL(to, window.location.origin);
    pathname = url.pathname;
    search = url.search;
    hash = url.hash;
  } catch {
    pathname = to.split(/[?#]/)[0] || '/';
  }
  let path = stripBase(pathname);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return `${path || '/'}${search}${hash}`;
}

const signUpHref = `${basePath}/sign-up`;
const signInHref = `${basePath}/sign-in`;
const homeHref = basePath || '/';

const CLERK_LOAD_TIMEOUT_MS = 8000;

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#75c853',
    colorForeground: '#f2f3f4',
    colorMutedForeground: '#a2a4aa',
    colorDanger: '#f87171',
    colorBackground: '#17181b',
    colorInput: '#101113',
    colorInputForeground: '#f2f3f4',
    colorNeutral: '#3a3b40',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#17181b] rounded-2xl w-[440px] max-w-full overflow-hidden border border-white/10',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-white',
    headerSubtitle: 'text-white/65',
    socialButtonsBlockButtonText: 'text-white',
    formFieldLabel: 'text-white/80',
    footerActionLink: 'text-emerald-300',
    footerActionText: 'text-white/60',
    dividerText: 'text-white/50',
    identityPreviewEditButton: 'text-emerald-300',
    formFieldSuccessText: 'text-emerald-300',
    alertText: 'text-red-200',
    logoBox: 'hidden',
    logoImage: 'hidden',
    socialButtonsBlockButton: 'bg-[#101113] border border-white/10 hover:bg-white/5',
    formButtonPrimary: 'bg-[#257c3c] text-white hover:bg-[#2c9147]',
    formFieldInput: 'bg-[#101113] text-white border border-white/10',
    footerAction: 'text-white/60',
    dividerLine: 'bg-white/10',
    alert: 'bg-red-500/10 border border-red-400/20',
    otpCodeFieldInput: 'bg-[#101113] text-white border border-white/10',
    formFieldRow: 'text-white/80',
    main: 'text-white',
  },
};

type DesktopState = {
  visible: boolean;
  collapsed?: boolean;
  alwaysOnTop: boolean;
  contentProtection: boolean;
  captureActive: boolean;
  shortcutRegistered: boolean;
  platform: string;
  audioProtocol?: number;
  backgroundOpacity?: number;
  backgroundOpacityMin?: number;
  preferencesError?: string;
  version?: string;
  nativeAudioProtocol?: number;
  fontScale?: number;
  transcriptOpen?: boolean;
  clickThrough?: boolean;
  openAtLogin?: boolean;
  hotkeys?: { id: string; label: string; accelerator: string; registered: boolean }[];
  update?: { phase: string; version: string | null; percent: number | null; message: string };
};

type SonoraDesktopBridge = {
  isDesktop: true;
  platform: string;
  shortcut: string;
  show: () => Promise<DesktopState>;
  hide: () => Promise<DesktopState>;
  minimize?: () => Promise<DesktopState>;
  moveCollapsed?: (dx: number, dy: number) => Promise<DesktopState>;
  setLiveShortcuts?: (value: boolean) => Promise<DesktopState>;
  toggle: () => Promise<DesktopState>;
  quit: () => Promise<void>;
  getState: () => Promise<DesktopState>;
  setBackgroundOpacity?: (value: number) => Promise<DesktopState>;
  startBrowserSignIn?: () => Promise<{ id: string; code: string; expiresAt: string }>;
  pollBrowserSignIn?: (id: string) => Promise<{ status: "pending" | "complete"; ticket?: string }>;
  cancelBrowserSignIn?: (id: string) => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<DesktopState>;
  setContentProtection: (value: boolean) => Promise<DesktopState>;
  setCaptureActive: (value: boolean) => Promise<DesktopState>;
  startNativeCapture?: (captureId: string, source: "microphone" | "system", deviceName?: string, referenceDevice?: string) => Promise<{ captureId: string }>;
  listAudioDevices?: (source: "microphone" | "system") => Promise<string[]>;
  captureScreen?: () => Promise<string | null>;
  stopNativeCapture?: (captureId: string) => Promise<boolean>;
  stopAllCapture?: () => Promise<void>;
  checkForUpdates?: () => Promise<{ phase: string; version: string | null; percent: number | null; message: string; available?: boolean; url?: string; signing?: string; sha256?: string }>;
  updateStatus?: () => Promise<{ phase: string; version: string | null; percent: number | null; message: string }>;
  installUpdate?: () => Promise<boolean>;
  retryConnection?: () => Promise<boolean>;
  setFontScale?: (value: number) => Promise<DesktopState>;
  setTranscriptOpen?: (value: boolean) => Promise<DesktopState>;
  setClickThrough?: (value: boolean) => Promise<DesktopState>;
  setControlsHover?: (value: boolean) => Promise<DesktopState>;
  setPointerCapture?: (capture: boolean) => void;
  e2eFlags?: () => Promise<{ transparent: boolean; frameless: boolean; alwaysOnTop: boolean; clickThrough: boolean; ignoringMouse: boolean; backgroundMaterial: string }>;
  setOpenAtLogin?: (value: boolean) => Promise<DesktopState>;
  setHotkeys?: (value: Record<string, string>) => Promise<DesktopState>;
  resetHotkeys?: () => Promise<DesktopState>;
  onCommand?: (listener: (action: string) => void) => () => void;
  onUpdate?: (listener: (status: NonNullable<DesktopState["update"]>) => void) => () => void;
  getDiagnostics?: () => Promise<Record<string, string | number | boolean>>;
  exportDiagnostics?: () => Promise<boolean>;
  onNativeAudio?: (listener: (event: {
    captureId: string; type: "audio" | "pcm" | "silence" | "error" | "status";
    audio?: string; prolonged?: boolean; message?: string; source?: "microphone" | "system"; capturedAt?: string; endOfTurn?: boolean;
    peak?: number; sampleAgeMs?: number;
  }) => void) => () => void;
  onStopCapture: (listener: () => void) => () => void;
  onStateChange: (listener: (state: DesktopState) => void) => () => void;
};

declare global {
  interface Window {
    sonoraDesktop?: SonoraDesktopBridge;
  }
}

function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="#top" aria-label="Sonora AI" className={`flex items-center gap-2.5 ${light ? 'text-[#fffdf7]' : 'text-[#19373a]'}`} data-testid="link-logo">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#f0c76c] text-[#19373a]">
        <span className="absolute h-3.5 w-1 rounded-full bg-[#19373a]" />
        <span className="absolute -ml-[9px] h-2.5 w-1 rounded-full bg-[#19373a]/70" />
        <span className="absolute ml-[9px] h-2.5 w-1 rounded-full bg-[#19373a]/70" />
      </span>
      <span className="text-[1.12rem] font-bold tracking-[-.04em]">sonora</span>
    </a>
  );
}

function App() {
  if (window.sonoraDesktop && window.location.protocol === 'file:') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#101113] p-6 text-white">
        <section className="max-w-md rounded-2xl border border-white/10 bg-[#17181b] p-6">
          <h1 className="text-lg font-semibold">Open the hosted Sonora workspace</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">This local desktop build is not connected to sign-in or the API server. It cannot capture call audio or generate answers. Open the hosted app in your browser, or run the desktop shell with SONORA_DESKTOP_URL set to the hosted app URL.</p>
          <button className="mt-5 rounded-lg border border-white/15 px-4 py-2 text-sm" onClick={() => void window.sonoraDesktop?.hide()}>Hide window</button>
        </section>
      </main>
    );
  }
  if (!clerkPubKey) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the app environment');
  }
  return (
    <WouterRouter base={basePath}>
      <DesktopVisibilityControls />
      <AuthServiceBoundary><ClerkProviderWithRoutes /></AuthServiceBoundary>
    </WouterRouter>
  );
}

function ClerkProviderWithRoutes() {
  const [location, setLocation] = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const setLocationRef = useRef(setLocation);
  setLocationRef.current = setLocation;
  const navBudget = useRef({ at: 0, count: 0 });
  const navigate = useCallback((to: string, replace: boolean) => {
    const next = toAppPath(to);
    const current = toAppPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    if (next === current || next === toAppPath(locationRef.current)) return;
    const now = Date.now();
    if (now - navBudget.current.at > 2000) navBudget.current = { at: now, count: 0 };
    navBudget.current.count += 1;
    if (navBudget.current.count > 6) {
      console.error('Stopped a repeated sign-in navigation');
      return;
    }
    setLocationRef.current(next, replace ? { replace: true } : undefined);
  }, []);
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your Sonora sessions' } },
        signUp: { start: { title: 'Create your account', subtitle: 'Set up your live meeting companion' } },
      }}
      routerPush={(to) => navigate(to, false)}
      routerReplace={(to) => navigate(to, true)}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <ResolvedAuth><Switch>
              <Route path="/download">{() => <main className="min-h-screen bg-[#101113]"><DesktopDownloads /></main>}</Route>
              <Route path="/desktop-connect/:id">{(params) => <GatedDesktopConnect key={params.id} params={params} />}</Route>
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/pricing" component={PricingPage} />
              <Route path="/privacy" component={PrivacyPage} />
              <Route path="/terms" component={TermsPage} />
              <Route path="/dashboard" component={DashboardPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/" component={HomeRedirect} />
              <Route component={NotFound} />
            </Switch></ResolvedAuth>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function ResolvedAuth({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);
  if (isLoaded) return children;
  return <main className="auth-screen" role="status">
    {timedOut ? <section className="auth-fallback"><h1>Sonora AI sign-in is taking longer than expected</h1><p>Check your connection and try again.</p><button onClick={() => window.location.reload()}>Try again</button><a href={homeHref}>Back to home</a></section> : <p>Loading Sonora AI…</p>}
  </main>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        cache.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, cache]);
  return null;
}

function SignInPage() {
  return <AuthPage mode="sign-in" />;
}

function SignUpPage() {
  return <AuthPage mode="sign-up" />;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [clerkFailed, setClerkFailed] = useState(false);
  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation('/', { replace: true });
  }, [isLoaded, isSignedIn, setLocation]);

  useEffect(() => {
    if (window.sonoraDesktop || isLoaded) {
      setClerkFailed(false);
      return;
    }
    const timer = window.setTimeout(() => setClerkFailed(true), CLERK_LOAD_TIMEOUT_MS);
    const onError = (event: ErrorEvent) => {
      const detail = `${event.filename || ''} ${event.message || ''}`;
      if (/clerk/i.test(detail)) setClerkFailed(true);
    };
    window.addEventListener('error', onError);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('error', onError);
    };
  }, [isLoaded]);

  useEffect(() => {
    if (window.sonoraDesktop || !isLoaded || clerkFailed) return;
    const timer = window.setTimeout(() => {
      if (!document.querySelector('.cl-rootBox, .cl-card, .cl-signIn-root, .cl-signUp-root')) {
        setClerkFailed(true);
      }
    }, CLERK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isLoaded, clerkFailed]);

  if (isLoaded && isSignedIn) return null;
  if (window.sonoraDesktop) {
    return (
      <div className={`flex min-h-[100dvh] items-center justify-center bg-[#101113] px-4 py-8 ${mode === 'sign-up' ? 'flex-col gap-6' : ''}`}>
        <DesktopBrowserSignIn />
      </div>
    );
  }

  const retry = () => {
    setClerkFailed(false);
    window.location.reload();
  };

  return (
    <div className="auth-screen">
      <a className="auth-brand" href={homeHref}>
        <img src={`${window.location.origin}${basePath}/logo.svg`} alt="Sonora AI" width={40} height={40} />
        <span>Sonora AI</span>
      </a>
      {clerkFailed ? (
        <div className="auth-fallback" role="alert">
          <h1>{mode === 'sign-in' ? 'Sign-in didn’t load' : 'Sign-up didn’t load'}</h1>
          <p>Sonora AI couldn’t reach the account service. Retry, or go back home and try again.</p>
          <button type="button" onClick={retry}>Try again</button>
          <a href={homeHref}>Back to home</a>
        </div>
      ) : !isLoaded ? (
        <div className="auth-loading" role="status" aria-live="polite">
          <span className="auth-spinner" aria-hidden="true" />
          <p>{mode === 'sign-in' ? 'Loading Sonora AI sign-in…' : 'Loading Sonora AI sign-up…'}</p>
        </div>
      ) : mode === 'sign-in' ? (
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
          forceRedirectUrl={`${basePath}/`} signUpForceRedirectUrl={`${basePath}/`} />
      ) : (
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}
          forceRedirectUrl={`${basePath}/`} signInForceRedirectUrl={`${basePath}/`} />
      )}
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function GatedDesktopConnect({ params }: { params: { id: string } }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) return <AccessGate><DesktopConnect params={params} /></AccessGate>;
  return <DesktopConnect params={params} />;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <div className="auth-screen" role="status"><p>Loading Sonora AI…</p></div>;
  return isSignedIn ? <AccessGate key={userId}><InterviewWorkspace key={userId} /></AccessGate> : window.sonoraDesktop ? <SignInPage /> : <LandingHome />;
}

function DashboardPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (isLoaded && !isSignedIn) setLocation('/sign-in', { replace: true });
  }, [isLoaded, isSignedIn, setLocation]);
  if (!isLoaded) {
    return (
      <div className="auth-screen" role="status">
        <p>Loading Sonora AI…</p>
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div className="auth-screen" role="status">
        <p>Taking you to sign in…</p>
      </div>
    );
  }
  return <AccessGate key={userId}><InterviewWorkspace key={userId} /></AccessGate>;
}

function PricingOffers() {
  return (
    <div>
      <div className="reference-pricing-grid">
        <article className="reference-plan reference-plan-free">
          <div className="reference-plan-top">
            <div>
              <div className="reference-plan-kicker">Free tier</div>
              <h3>Free</h3>
            </div>
            <span>10 FREE SESSIONS</span>
          </div>
          <p className="reference-plan-price">$0 <small>/ to start</small></p>
          <ul>
            <li><Check size={15} /> 10 sessions, up to 10 minutes each</li>
            <li><Check size={15} /> Longer sessions bill in 30-minute credit blocks</li>
          </ul>
          <a className="reference-plan-action" href={signUpHref}>Get 10 Free Sessions <ArrowRight size={15} /></a>
        </article>
      </div>
      <PricingCatalog />
    </div>
  );
}

function MarketingHeader({ current }: { current?: 'pricing' | 'privacy' | 'terms' }) {
  const { isSignedIn } = useAuth();
  return (
    <header className="reference-nav-bar">
      <nav className="reference-nav reference-nav-simple" aria-label="Sonora AI">
        <a className="marketing-wordmark" href={homeHref} aria-label="Sonora AI">
          <img src={`${basePath}/logo.svg`} alt="" width={31} height={31} />
          <span>sonora</span>
        </a>
        <div className="reference-nav-links">
          <a href={`${basePath}/#features`}>Features</a>
          <a href={`${basePath}/#how`}>How it works</a>
          <a href={`${basePath}/privacy`} aria-current={current === 'privacy' ? 'page' : undefined}>Privacy</a>
          <a href={`${basePath}/pricing`} aria-current={current === 'pricing' ? 'page' : undefined}>Pricing</a>
        </div>
        <div className="reference-nav-actions">
          <a className="reference-signin-link" href={isSignedIn ? `${basePath}/settings` : signInHref}>{isSignedIn ? 'Settings' : 'Sign in'}</a>
          <a className="reference-dark-button" href={isSignedIn ? `${basePath}/dashboard` : signUpHref}>{isSignedIn ? 'Dashboard' : 'Get started'} <ArrowRight size={14} /></a>
        </div>
      </nav>
    </header>
  );
}

function PricingPage() {
  useMarketingMeta('Pricing — Sonora AI', 'Start with free Sonora sessions, then pick a paid option such as a daily pass when you need more live meeting help.');
  return (
    <main className="marketing-page">
      <MarketingHeader current="pricing" />
      <section className="reference-pricing-section">
        <div className="reference-section-kicker">PRICING</div>
        <h2>Start with 10 free sessions.</h2>
        <p>Try Sonora on real calls first. When you need more time, choose one of the options below.</p>
        <PricingOffers />
      </section>
    </main>
  );
}

function LegalPage({ title, current, children }: { title: string; current: 'privacy' | 'terms'; children: ReactNode }) {
  return (
    <main className="marketing-page">
      <MarketingHeader current={current} />
      <article className="legal-page">
        <p className="legal-review-banner">Placeholder for review. This is generic draft text, not a final policy, and it has not been approved by counsel.</p>
        <h1>{title}</h1>
        {children}
        <p><a href={homeHref}>Back to Sonora AI</a></p>
      </article>
    </main>
  );
}

function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" current="privacy">
      <p>Sonora AI is a live meeting companion. This draft describes the privacy practices we expect to publish after review. It is not the live policy.</p>
      <h2>What this draft covers</h2>
      <p>Account details you submit at sign-up, session text you choose to save, and technical logs needed to run the service. Original audio files are not the product’s stored record in the current app; live listening depends on the browser permission you grant.</p>
      <h2>How this draft says information is used</h2>
      <p>To sign you in, to show your own sessions, and to generate answers during a session you start. This draft does not authorize selling personal information.</p>
      <h2>Your choices</h2>
      <p>You can stop a session, leave sign-in, or contact the team to ask for a review of this notice. Replace this page with counsel-approved language before relying on it.</p>
    </LegalPage>
  );
}

function TermsPage() {
  return (
    <LegalPage title="Terms of use" current="terms">
      <p>These terms are a placeholder so the page exists. They are not an offer, a contract, or a billing agreement.</p>
      <h2>Using Sonora AI</h2>
      <p>You may create an account and try the product, including the 10 free sessions described on the pricing page. Don’t misuse the service, attempt to break access controls, or upload material you don’t have rights to use.</p>
      <h2>Accounts and sessions</h2>
      <p>You’re responsible for the activity on your account. Sessions and generated notes are provided as a study aid. You decide what to say in a real conversation.</p>
      <h2>Paid plans</h2>
      <p>Any paid price shown in the product is carried over from an earlier Sonora landing page and is not a checkout. Do not treat it as a confirmed charge until a reviewed billing flow exists.</p>
    </LegalPage>
  );
}

function DesktopOverlay() {
  const bridge = window.sonoraDesktop;
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    if (!bridge) return;
    bridge.getState().then((state) => setAlwaysOnTop(state.alwaysOnTop));
    return bridge.onStateChange((state) => setAlwaysOnTop(state.alwaysOnTop));
  }, [bridge]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const formatTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const toggleRecording = () => {
    setShowHint(false);
    setRecording((current) => {
      if (current) setSeconds(0);
      return !current;
    });
  };
  const togglePinned = async () => {
    if (!bridge) return;
    const state = await bridge.setAlwaysOnTop(!alwaysOnTop);
    setAlwaysOnTop(state.alwaysOnTop);
  };

  return (
    <main className="desktop-overlay-page">
      <section className="desktop-overlay-card" aria-label="Sonora desktop assistant">
        <div className="desktop-overlay-grip" />
        <header className="desktop-overlay-header">
          <Logo />
          <div className="desktop-overlay-actions">
            <button className={`desktop-icon-button ${alwaysOnTop ? 'is-active' : ''}`} onClick={togglePinned} aria-label={alwaysOnTop ? 'Unpin overlay' : 'Keep overlay on top'} title={alwaysOnTop ? 'Unpin overlay' : 'Keep overlay on top'}>
              <span className="desktop-pin-dot" />
            </button>
            <button className="desktop-icon-button" onClick={() => bridge?.hide()} aria-label="Hide Sonora" title="Hide Sonora">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="desktop-overlay-status">
          <div className={`desktop-status-orb ${recording ? 'is-recording' : ''}`}>
            {recording ? <Activity size={18} /> : <Mic size={18} />}
          </div>
          <div>
            <div className="desktop-overlay-kicker">{recording ? 'Listening now' : 'Ready when you are'}</div>
            <h1>{recording ? 'Sonora is with you.' : 'Keep the thread.'}</h1>
          </div>
          <span className={`desktop-live-dot ${recording ? 'is-recording' : ''}`} />
        </div>

        <div className="desktop-waveform" aria-hidden="true">
          {Array.from({ length: 32 }).map((_, index) => (
            <span key={index} style={{ height: `${18 + ((index * 13) % 48)}%`, animationDelay: `${-(index % 7) * 0.16}s` }} />
          ))}
        </div>

        <div className="desktop-overlay-controls">
          <button className={`desktop-record-button ${recording ? 'is-recording' : ''}`} onClick={toggleRecording}>
            {recording ? <CircleStop size={17} /> : <Mic size={17} />}
            {recording ? 'Stop capture' : 'Start capture'}
          </button>
          <span className="desktop-timer">{recording ? formatTime(seconds) : '00:00'}</span>
        </div>

        <div className="desktop-overlay-insight">
          <Sparkles size={14} />
          <span>{recording ? 'Live notes will appear here as your conversation unfolds.' : 'A quiet co-pilot for the moments that matter.'}</span>
        </div>

        {showHint && <div className="desktop-overlay-hint"><Command size={12} /> {bridge?.shortcut ?? 'Ctrl/Cmd + Shift + Space'} to hide</div>}
      </section>
    </main>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

const marketingFeatures = [
  { icon: Mic, title: 'Live transcription, your way', body: 'Listen to your microphone, the call audio, or both. Follow the conversation as words appear live, with audio-source labels to help you follow along.' },
  { icon: Zap, title: 'Answers in the moment', body: 'Press Ctrl+Enter for a suggested answer to what was just said, or turn on Auto Answer and let Sonora respond to questions as they come.' },
  { icon: Command, title: 'Screenshot, then ask', body: 'Capture what is on your screen, a slide, a chart, a code snippet, and have Sonora explain or analyze it without leaving the call.' },
  { icon: Sparkles, title: 'Chat on the side', body: 'Type a quick question mid-meeting. Sonora answers with the conversation and your context already in view.' },
  { icon: FileAudio, title: 'Bring your context', body: 'Add a resume, a brief, or reference documents before you start so suggestions sound like you and fit the room.' },
  { icon: Headphones, title: 'Many call languages', body: 'Choose the language of the conversation. Sonora transcribes and responds across multiple call languages.' },
];

const overlayPoints = [
  ['See-through', 'Adjust the overlay opacity so your meeting stays visible underneath.'],
  ['Movable', 'Drag it wherever it stays out of the way of faces and slides.'],
  ['Collapsible', 'Fold it down to the Sonora logo when you just want to listen.'],
  ['Screen-share aware', 'Sonora asks Windows to exclude the overlay from screen capture. Whether that holds depends on your OS version and the sharing app, so check before it matters.'],
];

const howSteps = [
  ['Set up the session', 'Name it, add any documents or a resume, pick the call language, and decide whether the transcript is saved.'],
  ['Choose what Sonora hears', 'Microphone, call audio, or both. Nothing joins your meeting as a participant; Sonora listens on your device.'],
  ['Ask when you need it', 'Ctrl+Enter for an answer, a screenshot for something visual, or chat for anything else. Then get back to the conversation.'],
];

const meetingUses = ['Sales calls', 'Client meetings', 'Standups', 'Lectures', 'Interviews', 'One-on-ones'];
const worksWith = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Webex', 'Slack huddles'];

const marketingFaq = [
  ['Does Sonora join my meeting as a bot?', 'No. There is no meeting bot and no extra name in the participant list. Sonora runs on your computer and listens to the audio sources you pick.'],
  ['Which meeting apps does it work with?', 'Sonora listens to audio on your device rather than plugging into a specific platform, so it works alongside Zoom, Google Meet, Microsoft Teams, Webex, Slack huddles, and most other call apps.'],
  ['Will other people see the overlay when I share my screen?', 'On Windows, Sonora asks the system to exclude its overlay from screen capture. Support varies by Windows version and by sharing app, so we cannot promise it is hidden everywhere. Do a quick test share before an important call.'],
  ['Does it write meeting summaries or action items?', 'Not today. Sonora is built for help during the call. If you turn on transcript saving, you keep the session transcript as a record you can review later.'],
  ['Is it only for interviews?', 'No. Interviews are one use. People bring Sonora to sales calls, client meetings, standups, lectures, and any conversation where a quick, well-informed answer helps.'],
  ['What do I need to start?', 'Windows for the desktop overlay, or a modern browser for the web app. Session access requires approval; you will see your account status after you sign up. Audio capture availability depends on your device and browser.'],
  ['How does pricing work?', 'Start with free sessions, then choose a paid option such as a daily pass when you need more. Current offers are on the pricing page.'],
];

function useMarketingMeta(title: string, description: string) {
  useEffect(() => {
    if (window.sonoraDesktop) return;
    const previous = document.title;
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', description);
    return () => {
      document.title = previous;
      if (meta && prevDesc !== null) meta.setAttribute('content', prevDesc);
    };
  }, [title, description]);
}

function LandingHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const downloadHref = `${basePath}/download`;
  const pricingHref = `${basePath}/pricing`;
  useMarketingMeta('Sonora AI — AI Meeting Assistant & Live Transcription', 'Live transcription, AI answers, screenshot analysis, and chat for your meetings. Sonora works on Windows and web, with no meeting bot joining your calls.');
  const navItems = [['#features', 'Features'], ['#how', 'How it works'], ['#uses', 'Use cases'], ['#faq', 'FAQ']];

  return (
    <main id="top" className="sm-page">
      <header className="sm-header">
        <nav className="sm-nav" aria-label="Sonora AI">
          <a className="sm-brand" href={homeHref} data-testid="link-logo">
            <img src={`${basePath}/logo.svg`} alt="" width={32} height={32} />
            <span>sonora</span>
          </a>
          <div className="sm-nav-links">
            {navItems.map(([href, label]) => <a key={href} href={href} data-testid={`link-nav-${href.slice(1)}`}>{label}</a>)}
            <a href={pricingHref} data-testid="link-nav-pricing">Pricing</a>
          </div>
          <div className="sm-nav-actions">
            <a className="sm-link-quiet" href={signInHref} data-testid="button-sign-in">Sign in</a>
            <a className="sm-btn sm-btn-primary sm-btn-sm" href={signUpHref} data-testid="button-nav-start">Get started</a>
          </div>
          <HomepageThemeToggle />
          <button className="sm-menu-btn" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={menuOpen ? 'Close menu' : 'Open menu'} data-testid="button-mobile-menu">
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>
        {menuOpen && <div className="sm-mobile-menu">
          {navItems.map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
          <a href={pricingHref}>Pricing</a>
          <a href={signInHref}>Sign in</a>
          <a className="sm-btn sm-btn-primary" href={signUpHref}>Get started</a>
        </div>}
      </header>

      <section className="sm-hero">
        <div className="sm-hero-copy">
          <p className="sm-kicker"><span className="sm-live-dot" /> Your AI meeting assistant</p>
          <h1>Stay in the conversation. <em>Sonora handles the lookup.</em></h1>
          <p className="sm-lede">Sonora listens alongside your call, keeps a live transcript, and gives you a clear answer the moment you ask, so you can keep your attention on the people in front of you.</p>
          <div className="sm-hero-actions">
            <a className="sm-btn sm-btn-primary" href={downloadHref} data-testid="button-hero-download"><Download size={17} /> Download for Windows</a>
            <a className="sm-btn sm-btn-ghost" href={signUpHref} data-testid="button-hero-start">Get started <ArrowRight size={16} /></a>
          </div>
          <p className="sm-fine">Windows desktop app and web. No meeting bot joins your call.</p>
        </div>

        <HomepageDemo />
      </section>

      <section className="sm-works" aria-label="Use it during calls on">
        <span>Use it during calls on</span>
        <ul>{worksWith.map((name) => <li key={name}>{name}</li>)}</ul>
        <p>No integration or meeting bot needed. Sonora listens to your device audio.</p>
      </section>

      <section id="features" className="sm-section sm-anchor">
        <div className="sm-section-head">
          <p className="sm-kicker">Features</p>
          <h2>Help while it still matters, <em>not after the call.</em></h2>
          <p>Everything in Sonora is built for the live moment: hearing clearly, answering quickly, and staying out of your way.</p>
        </div>
        <div className="sm-feature-grid">
          {marketingFeatures.map(({ icon: Icon, title, body }, index) => (
            <article key={title} className="sm-feature" data-testid={`card-feature-${index}`}>
              <span className="sm-feature-icon"><Icon size={18} /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>

        <div className="sm-overlay-band">
          <div>
            <p className="sm-kicker">The Windows overlay</p>
            <h3>A small window that knows its place.</h3>
            <p>Sonora sits on top of your meeting without covering it. Tune it until it feels like part of the desk.</p>
          </div>
          <dl>
            {overlayPoints.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}
          </dl>
        </div>

        <div className="sm-record">
          <div><p className="sm-kicker">Keep a record</p><h3>Save the transcript when you want one.</h3></div>
          <p>Turn on transcript saving for a session and review it in your saved sessions later. You choose whether Sonora saves the transcript.</p>
        </div>
      </section>

      <section id="how" className="sm-section sm-how sm-anchor">
        <div className="sm-section-head">
          <p className="sm-kicker">How it works</p>
          <h2>Three steps, <em>then back to the room.</em></h2>
        </div>
        <ol className="sm-steps">
          {howSteps.map(([title, body], index) => (
            <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{body}</p></li>
          ))}
        </ol>
      </section>

      <section id="uses" className="sm-section sm-uses sm-anchor">
        <div className="sm-section-head">
          <p className="sm-kicker">Where it helps</p>
          <h2>One companion <em>for every kind of call.</em></h2>
          <p>A pricing question on a sales call, an acronym in a standup, a definition in a lecture, a follow-up in an interview. Same quiet help, different rooms.</p>
        </div>
        <ul className="sm-use-list">{meetingUses.map((use) => <li key={use}>{use}</li>)}</ul>
      </section>

      <section id="faq" className="sm-section sm-faq sm-anchor">
        <div className="sm-section-head">
          <p className="sm-kicker">FAQ</p>
          <h2>Straight answers.</h2>
        </div>
        <div className="sm-faq-list">
          {marketingFaq.map(([question, answer], index) => {
            const open = openFaq === index;
            return (
              <div key={question} className={`sm-faq-item ${open ? 'is-open' : ''}`}>
                <button onClick={() => setOpenFaq(open ? null : index)} aria-expanded={open} aria-controls={`faq-${index}`} data-testid={`button-faq-${index}`}>
                  <span>{question}</span><ChevronDown size={18} />
                </button>
                {open && <p id={`faq-${index}`}>{answer}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="sm-cta">
        <h2>Your next call, <em>with a little backup.</em></h2>
        <p>Start free. Add a daily pass when you have a big day ahead.</p>
        <div className="sm-hero-actions">
          <a className="sm-btn sm-btn-primary" href={downloadHref} data-testid="button-cta-download"><Download size={17} /> Download for Windows</a>
          <a className="sm-btn sm-btn-ghost" href={signUpHref} data-testid="button-cta-start">Get started <ArrowRight size={16} /></a>
        </div>
      </section>

      <footer className="sm-footer">
        <a className="sm-brand" href={homeHref}><img src={`${basePath}/logo.svg`} alt="" width={26} height={26} /><span>sonora</span></a>
        <nav aria-label="Site">
          <a href={pricingHref}>Pricing</a>
          <a href={downloadHref}>Download</a>
          <a href={`${basePath}/privacy`}>Privacy</a>
          <a href={`${basePath}/terms`}>Terms</a>
        </nav>
        <span>© 2026 Sonora AI · A live companion for meetings.</span>
      </footer>
    </main>
  );
}

export default App;
