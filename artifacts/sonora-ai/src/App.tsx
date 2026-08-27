import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Activity, Calendar, Check, ChevronDown, CircleStop, Clock3, Command, FileAudio, Headphones, LockKeyhole, Menu, Mic, Pause, Play, Search, ShieldCheck, Sparkles, Upload, Wand2, X, Zap } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const transcriptLines = [
  { time: '00:14', speaker: 'Maya', text: 'The real question is where the handoff starts to feel heavy.' },
  { time: '00:27', speaker: 'You', text: 'Exactly. We want the team to move without adding another inbox.' },
  { time: '00:41', speaker: 'Maya', text: 'Then the first week should feel less like setup, more like momentum.' },
];

const useCases = [
  { number: '01', title: 'Stay in the room', body: 'Live notes, quiet nudges, and the names you forgot to write down. Sonora keeps you present.', icon: Headphones, color: 'bg-[#f0c76c]' },
  { number: '02', title: 'Find the moment', body: 'Search every conversation by idea, person, or phrase. The answer is always one clear query away.', icon: Search, color: 'bg-[#6db6a5]' },
  { number: '03', title: 'Leave with a plan', body: 'Every recording becomes a brief with decisions, owners, and the next useful move already pulled forward.', icon: Wand2, color: 'bg-[#e98068]' },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="#top" className={`flex items-center gap-2.5 ${light ? 'text-[#fffdf7]' : 'text-[#19373a]'}`} data-testid="link-logo">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#f0c76c] text-[#19373a]">
        <span className="absolute h-3.5 w-1 rounded-full bg-[#19373a]" />
        <span className="absolute -ml-[9px] h-2.5 w-1 rounded-full bg-[#19373a]/70" />
        <span className="absolute ml-[9px] h-2.5 w-1 rounded-full bg-[#19373a]/70" />
      </span>
      <span className="text-[1.12rem] font-bold tracking-[-.04em]">sonora</span>
    </a>
  );
}

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return <div className={`reveal ${delay ? `reveal-delay-${delay}` : ''} ${className}`}>{children}</div>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uploadState, setUploadState] = useState<'idle' | 'processing' | 'ready'>('idle');
  const [playing, setPlaying] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(0);
  const [librarySearch, setLibrarySearch] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const uploadTimerRef = useRef<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!recording) {
      window.clearInterval(timerRef.current);
      return;
    }
    timerRef.current = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timerRef.current);
  }, [recording]);

  useEffect(() => () => window.clearTimeout(uploadTimerRef.current), []);

  const startRecording = () => {
    setUploadState('idle');
    setRecording((current) => {
      if (current) setSeconds(0);
      return !current;
    });
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.[0]) return;
    setRecording(false);
    setUploadState('processing');
    uploadTimerRef.current = window.setTimeout(() => setUploadState('ready'), 2300);
  };

  const jumpToDemo = () => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
  const formatTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

  return (
    <main id="top" className="sonora-page min-h-[100dvh]">
      <nav className="fixed left-0 right-0 top-0 z-50 px-4 pt-4 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between rounded-2xl border border-[#19373a]/10 bg-[#f6f3eb]/90 px-4 py-3 shadow-[0_10px_40px_rgba(25,55,58,.06)] backdrop-blur-xl sm:px-6">
          <Logo />
          <div className="hidden items-center gap-8 text-[.82rem] font-medium md:flex">
            <a className="nav-link" href="#how-it-works" data-testid="link-how-it-works">How it works</a>
            <a className="nav-link" href="#use-cases" data-testid="link-use-cases">Use cases</a>
            <a className="nav-link" href="#pricing" data-testid="link-pricing">Pricing</a>
            <a className="nav-link" href="#faq" data-testid="link-faq">FAQ</a>
          </div>
          <div className="hidden items-center gap-5 md:flex">
            <button className="text-[.82rem] font-semibold text-[#19373a]/70 transition hover:text-[#19373a]" onClick={jumpToDemo} data-testid="button-sign-in">Sign in</button>
            <button className="sonora-button flex items-center gap-2 rounded-xl bg-[#19373a] px-4 py-2.5 text-[.78rem] font-semibold text-[#fffdf7]" onClick={jumpToDemo} data-testid="button-nav-start">Try Sonora <ArrowUpRight size={14} /></button>
          </div>
          <button className="rounded-lg p-2 md:hidden" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} data-testid="button-mobile-menu">
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {menuOpen && (
          <div className="mx-auto mt-2 max-w-[1240px] rounded-2xl border border-[#19373a]/10 bg-[#fffdf7] p-4 shadow-xl md:hidden">
            <div className="flex flex-col gap-1">
              {['how-it-works', 'use-cases', 'pricing', 'faq'].map((section) => (
                <a key={section} href={`#${section}`} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-3 text-sm font-semibold capitalize transition hover:bg-[#f6f3eb]" data-testid={`link-mobile-${section}`}>{section.replaceAll('-', ' ')}</a>
              ))}
              <button className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#19373a] px-4 py-3 text-sm font-semibold text-[#fffdf7]" onClick={() => { setMenuOpen(false); jumpToDemo(); }} data-testid="button-mobile-start">Try Sonora <ArrowUpRight size={15} /></button>
            </div>
          </div>
        )}
      </nav>

      <section className="grain relative overflow-hidden bg-[#f6f3eb] px-5 pb-20 pt-36 sm:px-8 sm:pt-44 lg:px-12 lg:pb-28">
        <div className="absolute -right-32 top-20 h-[490px] w-[490px] rounded-full bg-[#f0c76c]/30 blur-3xl" />
        <div className="absolute -left-52 bottom-0 h-[380px] w-[480px] rounded-full bg-[#6db6a5]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1240px]">
          <div className="grid items-end gap-14 lg:grid-cols-[1.03fr_.97fr] lg:gap-10">
            <div>
              <Reveal>
                <div className="mb-7 flex items-center gap-3 text-[#e98068]">
                  <span className="h-px w-8 bg-[#e98068]" />
                  <span className="eyebrow text-[#e98068]">A co-pilot for the conversation</span>
                </div>
              </Reveal>
              <Reveal delay={1}>
                <h1 className="max-w-[700px] text-[clamp(3.7rem,8vw,7.8rem)] font-normal leading-[.86] tracking-[-.07em] text-[#19373a]">
                  Hear more.<br /><em className="sonora-display text-[#e98068]">Remember</em> everything.
                </h1>
              </Reveal>
              <Reveal delay={2}>
                <p className="mt-8 max-w-[470px] text-[1.05rem] leading-7 text-[#19373a]/65">
                  Sonora turns the conversations that move your work forward into clear notes, searchable knowledge, and calm guidance — while you stay in the room.
                </p>
              </Reveal>
              <Reveal delay={3}>
                <div className="mt-9 flex flex-wrap items-center gap-4">
                  <button className="sonora-button flex items-center gap-3 rounded-xl bg-[#19373a] px-5 py-3.5 text-sm font-semibold text-[#fffdf7]" onClick={jumpToDemo} data-testid="button-hero-start">Record a conversation <ArrowRight size={16} /></button>
                  <a className="flex items-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold text-[#19373a]/65 transition hover:text-[#19373a]" href="#how-it-works" data-testid="link-hero-learn">See how it works <ArrowUpRight size={15} /></a>
                </div>
              </Reveal>
              <Reveal delay={3}>
                <div className="mt-12 flex items-center gap-4">
                  <div className="flex -space-x-2">
                    {['JM', 'AS', 'LK'].map((initials, index) => <span key={initials} className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#f6f3eb] text-[.62rem] font-bold ${index === 0 ? 'bg-[#e98068]' : index === 1 ? 'bg-[#6db6a5]' : 'bg-[#f0c76c]'}`}>{initials}</span>)}
                  </div>
                  <span className="text-xs text-[#19373a]/55"><strong className="font-bold text-[#19373a]">12,400+</strong> thoughtful conversations captured</span>
                </div>
              </Reveal>
            </div>

            <Reveal className="relative lg:pb-2" delay={2}>
              <div className="relative mx-auto max-w-[560px]">
                <div className="absolute -right-2 -top-7 z-10 hidden -rotate-3 items-center gap-2 rounded-full border border-[#19373a]/10 bg-[#fffdf7] px-3 py-2 text-[.66rem] font-bold shadow-lg sm:flex">
                  <span className="h-2 w-2 rounded-full bg-[#6db6a5]" /> listening in the background
                </div>
                <div className="float-slow relative overflow-hidden rounded-[28px] border border-[#19373a]/15 bg-[#173438] p-3 shadow-[0_28px_60px_rgba(23,52,56,.22)]">
                  <div className="rounded-[21px] border border-[#fffdf7]/10 bg-[#214348] p-5 sm:p-7">
                    <div className="mb-8 flex items-start justify-between">
                      <div>
                        <div className="eyebrow text-[#f0c76c]/80">Live session</div>
                        <h2 className="mt-2 text-xl font-semibold tracking-[-.03em] text-[#fffdf7]">Monday / product sync</h2>
                      </div>
                      <div className="rounded-lg border border-[#fffdf7]/15 p-2 text-[#f0c76c]"><Activity size={17} /></div>
                    </div>
                    <div className="flex h-[145px] items-center gap-[5px] rounded-2xl bg-[#173438]/80 px-5 text-[#f0c76c]">
                      {Array.from({ length: 44 }).map((_, i) => <span key={i} className="wave-bars h-20 flex-1" style={{ color: i % 7 === 0 ? '#e98068' : '#f0c76c' }}><span style={{ height: `${25 + ((i * 17) % 66)}%`, animationDelay: `${-(i % 8) * .17}s` }} /></span>)}
                    </div>
                    <div className="mt-5 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-[#fffdf7]/50"><span className="h-2 w-2 animate-pulse rounded-full bg-[#e98068]" /> Capturing audio</div>
                      <span className="sonora-mono text-[.68rem] text-[#fffdf7]/50">00:42:18</span>
                    </div>
                    <div className="mt-7 border-t border-[#fffdf7]/10 pt-5">
                      <div className="mb-3 flex items-center gap-2 text-[.66rem] font-bold uppercase tracking-[.14em] text-[#6db6a5]"><Sparkles size={13} /> Sonora noticed</div>
                      <p className="text-[.91rem] leading-6 text-[#fffdf7]/80">“The launch needs a smaller first step.” <span className="text-[#fffdf7]/40">— Maya, 00:41</span></p>
                    </div>
                  </div>
                </div>
                <div className="absolute -bottom-6 -left-7 hidden rotate-2 rounded-2xl border border-[#19373a]/10 bg-[#fffdf7] p-4 shadow-xl sm:block">
                  <div className="flex items-center gap-2 text-[.65rem] font-bold text-[#19373a]/55"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e98068]/20 text-[#e98068]"><Zap size={12} /></span> 3 next steps found</div>
                </div>
              </div>
            </Reveal>
          </div>
          <div className="mt-24 flex flex-wrap items-center justify-between gap-5 border-t border-[#19373a]/10 pt-5 text-[#19373a]/45">
            <span className="eyebrow">Trusted by people who listen closely</span>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[.74rem] font-bold tracking-[.08em]"><span>FIELDNOTE</span><span>COMMON ROOM</span><span>MONDAY CLUB</span><span>ATLAS / 04</span></div>
          </div>
        </div>
      </section>

      <section id="demo" className="scroll-mt-24 bg-[#19373a] px-5 py-20 text-[#fffdf7] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1240px]">
          <Reveal>
            <div className="mb-12 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div><div className="eyebrow text-[#f0c76c]">Try the real thing</div><h2 className="sonora-display mt-3 max-w-[560px] text-5xl leading-[.95] tracking-[-.04em] sm:text-6xl">Your next good note starts here.</h2></div>
              <p className="max-w-[280px] text-sm leading-6 text-[#fffdf7]/55">No account, no setup. Record for a moment or bring a file from your last conversation.</p>
            </div>
          </Reveal>
          <Reveal delay={1}>
            <div className="grid overflow-hidden rounded-[24px] border border-[#fffdf7]/12 bg-[#214348] lg:grid-cols-[.96fr,1.04fr]">
              <div className="grid-paper relative flex min-h-[390px] flex-col justify-between border-b border-[#fffdf7]/10 p-6 sm:p-9 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f0c76c] text-[#19373a]"><Mic size={14} /></span> New conversation</div>
                  <span className="sonora-mono text-[.65rem] text-[#fffdf7]/40">{recording ? 'LIVE' : 'READY'}</span>
                </div>
                <div className="py-8">
                  <div className={`mx-auto flex h-36 w-36 items-center justify-center rounded-full border ${recording ? 'border-[#e98068] bg-[#e98068]/10' : 'border-[#f0c76c]/35 bg-[#f0c76c]/5'} transition`}>
                    <button className={`flex h-24 w-24 items-center justify-center rounded-full ${recording ? 'bg-[#e98068]' : 'bg-[#f0c76c]'} text-[#19373a] shadow-[0_0_0_12px_rgba(240,199,108,.08)] transition hover:scale-105`} onClick={startRecording} aria-label={recording ? 'Stop recording' : 'Start recording'} data-testid="button-demo-record">
                      {recording ? <CircleStop size={30} /> : <Mic size={30} />}
                    </button>
                  </div>
                  <div className="mt-5 text-center">
                    <div className="text-sm font-semibold">{recording ? 'Sonora is listening' : uploadState === 'ready' ? 'Conversation ready' : 'Tap to record'}</div>
                    <div className="sonora-mono mt-2 text-[.68rem] text-[#fffdf7]/45">{recording ? formatTime(seconds) : uploadState === 'processing' ? 'preparing your transcript...' : 'your voice stays yours'}</div>
                  </div>
                </div>
                <div className="border-t border-[#fffdf7]/10 pt-5">
                  <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a" className="hidden" onChange={handleUpload} data-testid="input-audio-upload" />
                  <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#fffdf7]/25 px-4 py-3 text-xs font-semibold text-[#fffdf7]/70 transition hover:border-[#f0c76c] hover:text-[#fffdf7]" onClick={() => fileInputRef.current?.click()} data-testid="button-demo-upload">
                    {uploadState === 'processing' ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-[#f0c76c] border-t-transparent" /> Processing audio</> : uploadState === 'ready' ? <><Check size={15} className="text-[#6db6a5]" /> Audio is ready to review</> : <><Upload size={15} /> Or upload an audio file</>}
                  </button>
                </div>
              </div>
              <div className="min-h-[390px] bg-[#fffdf7] p-6 text-[#19373a] sm:p-9">
                <div className="flex items-center justify-between border-b border-[#19373a]/10 pb-5">
                  <div><div className="eyebrow text-[#e98068]">Transcript preview</div><div className="mt-2 text-lg font-semibold">A thoughtful conversation</div></div>
                  <div className="flex h-8 items-center gap-2 rounded-lg bg-[#f6f3eb] px-2.5 text-[.66rem] font-semibold text-[#19373a]/60"><Search size={13} /> Search</div>
                </div>
                {uploadState === 'processing' ? (
                  <div className="space-y-6 pt-8" data-testid="status-upload-processing">
                    {[1, 2, 3, 4].map((item) => <div key={item} className="animate-pulse"><div className="mb-2 h-2 w-14 rounded-full bg-[#19373a]/10" /><div className="h-3 w-[88%] rounded-full bg-[#19373a]/10" /><div className="mt-2 h-3 w-[64%] rounded-full bg-[#19373a]/10" /></div>)}
                  </div>
                ) : (
                  <div className="space-y-0 pt-5" data-testid="display-transcript-preview">
                    {transcriptLines.map((line) => <div key={line.time} className="group flex gap-4 py-4 first:pt-1"><span className="sonora-mono w-10 shrink-0 pt-1 text-[.63rem] text-[#19373a]/35">{line.time}</span><div><div className="mb-1 text-[.7rem] font-bold text-[#e98068]">{line.speaker}</div><p className="text-[.85rem] leading-5 text-[#19373a]/72">{line.text}</p></div></div>)}
                    <div className="mt-2 rounded-xl bg-[#f0c76c]/18 p-4"><div className="mb-1 flex items-center gap-1.5 text-[.65rem] font-bold uppercase tracking-[.12em] text-[#19373a]/60"><Sparkles size={12} /> Key insight</div><p className="text-[.8rem] leading-5">A smaller first step could make the launch feel lighter.</p></div>
                  </div>
                )}
                <div className="mt-5 flex items-center justify-between border-t border-[#19373a]/10 pt-4 text-[.67rem] text-[#19373a]/40"><span>{uploadState === 'ready' ? 'Imported just now' : 'English · automatic speaker labels'}</span><span className="flex items-center gap-1"><LockKeyhole size={11} /> private by default</span></div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 bg-[#fffdf7] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1240px]">
          <Reveal><div className="grid gap-8 lg:grid-cols-[.9fr,1.1fr]"><div><div className="eyebrow text-[#e98068]">The Sonora rhythm</div><h2 className="mt-4 max-w-[440px] text-5xl font-semibold leading-[.95] tracking-[-.065em] text-[#19373a] sm:text-6xl">Less catching up. More moving forward.</h2></div><p className="max-w-[420px] self-end text-[1.02rem] leading-7 text-[#19373a]/60">A conversation is more than words. Sonora catches the shape of it, so the useful parts keep working long after the call ends.</p></div></Reveal>
          <div className="mt-16 grid gap-4 md:grid-cols-3">
            {[
              { tag: '01 / CAPTURE', title: 'Stay present.', body: 'Record from your browser or drop in a file. Sonora quietly keeps up with every voice.', icon: Mic, tone: 'bg-[#f6f3eb]' },
              { tag: '02 / CLARIFY', title: 'See the signal.', body: 'A clean transcript, useful summary, and the moments worth another look — ready in minutes.', icon: Sparkles, tone: 'bg-[#f0c76c]' },
              { tag: '03 / CONTINUE', title: 'Keep momentum.', body: 'Search what was said, share the brief, and walk into the next conversation prepared.', icon: ArrowRight, tone: 'bg-[#6db6a5]' },
            ].map((item, index) => {
              const Icon = item.icon;
              return <Reveal key={item.tag} delay={index + 1}><div className={`${item.tone} group relative min-h-[300px] overflow-hidden rounded-[22px] p-6 transition hover:-translate-y-1 hover:shadow-xl sm:p-8`}><div className="flex items-center justify-between"><span className="eyebrow text-[#19373a]/55">{item.tag}</span><Icon size={19} className="text-[#19373a]/55 transition group-hover:rotate-[-12deg]" /></div><div className="absolute -bottom-8 -right-6 text-[10rem] font-normal leading-none tracking-[-.12em] text-[#19373a]/[.05]">{index + 1}</div><div className="absolute bottom-7 left-8 right-8"><h3 className="sonora-display text-4xl leading-none text-[#19373a]">{item.title}</h3><p className="mt-3 max-w-[270px] text-sm leading-5 text-[#19373a]/65">{item.body}</p></div></div></Reveal>;
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#f6f3eb] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1240px]">
          <Reveal><div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end"><div><div className="eyebrow text-[#e98068]">The command center</div><h2 className="mt-3 max-w-[620px] text-5xl font-semibold leading-[.95] tracking-[-.06em] text-[#19373a] sm:text-6xl">A clearer view of every conversation.</h2></div><span className="sonora-mono text-[.64rem] text-[#19373a]/45">SONORA / WORKSPACE / 09:42</span></div></Reveal>
          <Reveal delay={1}>
            <div className="overflow-hidden rounded-[24px] border border-[#19373a]/12 bg-[#fffdf7] shadow-[0_24px_70px_rgba(25,55,58,.10)]">
              <div className="flex items-center justify-between border-b border-[#19373a]/10 px-5 py-4 sm:px-7"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#19373a] text-[#f0c76c]"><span className="h-2.5 w-1 rounded-full bg-current" /></span><span className="font-semibold tracking-[-.03em]">sonora</span><span className="text-[#19373a]/20">/</span><span className="text-sm text-[#19373a]/50">Workspace</span></div><div className="flex items-center gap-2 text-xs text-[#19373a]/45"><Command size={13} /> K <span className="hidden sm:inline">to search</span></div></div>
              <div className="grid lg:grid-cols-[.7fr,1.3fr]">
                <div className="border-b border-[#19373a]/10 bg-[#f6f3eb]/65 p-5 sm:p-7 lg:border-b-0 lg:border-r">
                  <div className="mb-5 flex items-center justify-between"><span className="eyebrow text-[#19373a]/45">Your library</span><button className={`text-[#19373a]/50 transition hover:text-[#19373a] ${librarySearch ? 'text-[#e98068]' : ''}`} onClick={() => setLibrarySearch((value) => !value)} aria-label="Search library" data-testid="button-search-library"><Search size={16} /></button></div>
                  {librarySearch && <input autoFocus className="mb-3 w-full rounded-lg border border-[#19373a]/12 bg-[#fffdf7] px-3 py-2 text-xs outline-none ring-[#f0c76c] placeholder:text-[#19373a]/35 focus:ring-2" placeholder="Search conversations" data-testid="input-library-search" />}
                  <div className="space-y-2">
                    {['Monday / product sync', 'The field notes — March', 'Lena + Jonah / kickoff', 'Research roundtable'].map((name, index) => <button key={name} className={`w-full rounded-xl p-3 text-left transition ${index === selectedConversation ? 'bg-[#fffdf7] shadow-sm' : 'hover:bg-[#fffdf7]/75'}`} onClick={() => setSelectedConversation(index)} data-testid={`button-library-item-${index}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2 w-2 rounded-full ${index === selectedConversation ? 'bg-[#e98068]' : 'bg-[#6db6a5]'}`} /><div><div className="text-[.79rem] font-semibold">{name}</div><div className="mt-1 text-[.66rem] text-[#19373a]/45">{index === 0 ? 'Today, 09:42 · 42 min' : `${index + 1} days ago · ${18 + index * 7} min`}</div></div></div></button>)}
                  </div>
                  <button className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-[#19373a]/12 py-2.5 text-xs font-semibold text-[#19373a]/65 transition hover:bg-[#fffdf7]" onClick={jumpToDemo} data-testid="button-new-conversation"><Mic size={13} /> New conversation</button>
                </div>
                <div className="p-5 sm:p-7">
                  <div className="flex flex-col justify-between gap-4 border-b border-[#19373a]/10 pb-6 sm:flex-row"><div><div className="eyebrow text-[#e98068]">Monday / product sync</div><h3 className="mt-2 text-2xl font-semibold tracking-[-.04em]">Make the launch feel lighter</h3><div className="mt-2 flex items-center gap-3 text-[.68rem] text-[#19373a]/45"><Clock3 size={13} /> 42 min <span>·</span><span>3 speakers</span><span>·</span><span>12 highlights</span></div></div><button className="flex h-9 items-center gap-2 self-start rounded-lg bg-[#19373a] px-3 text-xs font-semibold text-[#fffdf7]" onClick={() => setPlaying((value) => !value)} data-testid="button-play-preview">{playing ? <Pause size={13} /> : <Play size={13} />} {playing ? 'Pause preview' : 'Play preview'}</button></div>
                  <div className="grid gap-6 pt-6 sm:grid-cols-[1fr,.85fr]"><div><div className="mb-4 flex items-center gap-1.5 text-[.66rem] font-bold uppercase tracking-[.14em] text-[#19373a]/50"><FileAudio size={13} /> Transcript</div>{transcriptLines.map((line) => <div key={line.time} className="mb-4 flex gap-3"><span className="sonora-mono pt-0.5 text-[.62rem] text-[#19373a]/35">{line.time}</span><p className="text-[.78rem] leading-5 text-[#19373a]/70"><strong className="mr-1 font-bold text-[#e98068]">{line.speaker}:</strong>{line.text}</p></div>)}</div><div><div className="mb-4 flex items-center gap-1.5 text-[.66rem] font-bold uppercase tracking-[.14em] text-[#19373a]/50"><Sparkles size={13} /> Sonora summary</div><div className="rounded-xl bg-[#f0c76c]/20 p-4"><p className="text-[.8rem] font-semibold leading-5">A smaller first step could make the launch feel lighter.</p><div className="mt-4 space-y-3 text-[.72rem] text-[#19373a]/70"><div className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-[#6c9f8e]" /> Pilot with five existing users</div><div className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-[#6c9f8e]" /> Share a one-page launch brief</div><div className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-[#6c9f8e]" /> Revisit the full release in April</div></div></div></div></div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="use-cases" className="scroll-mt-24 bg-[#e98068] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1240px]">
          <Reveal><div className="grid gap-8 lg:grid-cols-[.75fr,1.25fr]"><div><div className="eyebrow text-[#19373a]/60">Built for the in-between</div><h2 className="mt-4 max-w-[420px] text-5xl font-semibold leading-[.94] tracking-[-.06em] text-[#19373a] sm:text-6xl">The moments that usually get away.</h2></div><p className="max-w-[400px] self-end text-[1rem] leading-7 text-[#19373a]/68">For the calls that matter, the interviews that wander, and the small observations that become the big idea later.</p></div></Reveal>
          <div className="mt-16 grid gap-3 md:grid-cols-3">{useCases.map((item, index) => { const Icon = item.icon; return <Reveal key={item.number} delay={index + 1}><article className={`group ${item.color} min-h-[330px] rounded-[22px] p-6 transition hover:-translate-y-1 sm:p-8`}><div className="flex items-center justify-between"><span className="sonora-mono text-[.65rem] text-[#19373a]/55">{item.number}</span><span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#19373a]/15 text-[#19373a] transition group-hover:rotate-12"><Icon size={18} /></span></div><div className="mt-28"><h3 className="sonora-display text-4xl leading-none text-[#19373a]">{item.title}</h3><p className="mt-4 text-sm leading-6 text-[#19373a]/68">{item.body}</p></div></article></Reveal>; })}</div>
        </div>
      </section>

      <section className="bg-[#fffdf7] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[.8fr,1.2fr]">
          <Reveal><div><div className="eyebrow text-[#e98068]">A better kind of proof</div><h2 className="mt-4 max-w-[460px] text-5xl font-semibold leading-[.94] tracking-[-.06em] text-[#19373a] sm:text-6xl">Trust is built in the details.</h2><p className="mt-6 max-w-[400px] leading-7 text-[#19373a]/60">Sonora is designed around the part that matters most: feeling safe enough to pay attention.</p><button className="sonora-button mt-8 flex items-center gap-2 rounded-xl border border-[#19373a]/15 px-4 py-3 text-sm font-semibold" onClick={jumpToDemo} data-testid="button-proof-demo">See it in action <ArrowRight size={15} /></button></div></Reveal>
          <Reveal delay={1}><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-[22px] bg-[#19373a] p-7 text-[#fffdf7] sm:col-span-2"><div className="flex items-start justify-between"><ShieldCheck className="text-[#f0c76c]" size={22} /><span className="eyebrow text-[#fffdf7]/40">Privacy, plainly</span></div><div className="mt-14 grid gap-6 sm:grid-cols-[1fr,1fr]"><div><div className="text-4xl font-semibold tracking-[-.06em]">Private by default.</div><p className="mt-2 max-w-[330px] text-sm leading-6 text-[#fffdf7]/55">Your recordings are yours. Encrypted in transit, protected at rest, and never used to train a model without your say.</p></div><div className="space-y-3 text-sm text-[#fffdf7]/75"><div className="flex items-center gap-2"><Check size={15} className="text-[#6db6a5]" /> Delete anything, anytime</div><div className="flex items-center gap-2"><Check size={15} className="text-[#6db6a5]" /> Export your full library</div><div className="flex items-center gap-2"><Check size={15} className="text-[#6db6a5]" /> Clear speaker controls</div></div></div></div><div className="rounded-[22px] bg-[#f6f3eb] p-7"><Activity size={21} className="text-[#e98068]" /><div className="mt-12 text-4xl font-semibold tracking-[-.06em] text-[#19373a]">47.2<span className="text-[#e98068]">%</span></div><p className="mt-2 text-sm leading-5 text-[#19373a]/55">more follow-through on next steps, in our early user study.</p></div><div className="rounded-[22px] bg-[#f0c76c] p-7"><Calendar size={21} className="text-[#19373a]" /><div className="mt-12 text-4xl font-semibold tracking-[-.06em] text-[#19373a]">8.6<span className="text-[#19373a]/50">h</span></div><p className="mt-2 text-sm leading-5 text-[#19373a]/60">returned to a team every month, on average.</p></div></div></Reveal>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-24 bg-[#f6f3eb] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1240px]">
          <Reveal><div className="text-center"><div className="eyebrow text-[#e98068]">Simple, for now</div><h2 className="sonora-display mt-3 text-6xl leading-[.9] tracking-[-.05em] text-[#19373a] sm:text-7xl">Start listening.</h2><p className="mx-auto mt-5 max-w-[420px] text-sm leading-6 text-[#19373a]/60">The first 120 minutes are on us. Keep what works, change what doesn’t.</p></div></Reveal>
          <Reveal delay={1}><div className="mx-auto mt-12 grid max-w-[920px] gap-3 md:grid-cols-2"><div className="rounded-[22px] border border-[#19373a]/12 bg-[#fffdf7] p-7 sm:p-9"><div className="flex items-start justify-between"><div><div className="eyebrow text-[#19373a]/45">For curious individuals</div><h3 className="mt-4 text-2xl font-semibold tracking-[-.04em]">Listener</h3></div><span className="rounded-full bg-[#f6f3eb] px-3 py-1 text-[.65rem] font-bold">FREE</span></div><div className="mt-8 text-5xl font-semibold tracking-[-.07em]">$0 <span className="text-sm font-normal tracking-normal text-[#19373a]/40">/ forever</span></div><div className="my-8 h-px bg-[#19373a]/10" /><div className="space-y-3 text-sm text-[#19373a]/70"><div className="flex items-center gap-2"><Check size={15} className="text-[#6c9f8e]" /> 120 transcription minutes / month</div><div className="flex items-center gap-2"><Check size={15} className="text-[#6c9f8e]" /> Searchable conversation library</div><div className="flex items-center gap-2"><Check size={15} className="text-[#6c9f8e]" /> Automatic summaries</div></div><button className="sonora-button mt-9 flex w-full items-center justify-center gap-2 rounded-xl border border-[#19373a]/15 py-3.5 text-sm font-semibold" onClick={jumpToDemo} data-testid="button-pricing-free">Try Listener <ArrowRight size={15} /></button></div><div className="relative overflow-hidden rounded-[22px] bg-[#19373a] p-7 text-[#fffdf7] sm:p-9"><div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-[#f0c76c]/20 blur-2xl" /><div className="relative flex items-start justify-between"><div><div className="eyebrow text-[#f0c76c]">For people in motion</div><h3 className="mt-4 text-2xl font-semibold tracking-[-.04em]">Signal</h3></div><span className="rounded-full bg-[#f0c76c] px-3 py-1 text-[.65rem] font-bold text-[#19373a]">POPULAR</span></div><div className="relative mt-8 text-5xl font-semibold tracking-[-.07em]">$16 <span className="text-sm font-normal tracking-normal text-[#fffdf7]/40">/ month</span></div><div className="relative my-8 h-px bg-[#fffdf7]/15" /><div className="relative space-y-3 text-sm text-[#fffdf7]/75"><div className="flex items-center gap-2"><Check size={15} className="text-[#f0c76c]" /> Unlimited recordings and uploads</div><div className="flex items-center gap-2"><Check size={15} className="text-[#f0c76c]" /> Live guidance and smart highlights</div><div className="flex items-center gap-2"><Check size={15} className="text-[#f0c76c]" /> Exportable briefs and integrations</div></div><button className="sonora-button relative mt-9 flex w-full items-center justify-center gap-2 rounded-xl bg-[#f0c76c] py-3.5 text-sm font-semibold text-[#19373a]" onClick={jumpToDemo} data-testid="button-pricing-signal">Start with Signal <ArrowRight size={15} /></button></div></div></Reveal>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 bg-[#fffdf7] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-[1000px] gap-12 lg:grid-cols-[.7fr,1.3fr]"><Reveal><div><div className="eyebrow text-[#e98068]">Good questions</div><h2 className="mt-4 text-5xl font-semibold leading-[.94] tracking-[-.06em] text-[#19373a]">Worth asking.</h2><p className="mt-5 max-w-[240px] text-sm leading-6 text-[#19373a]/55">Still curious? We like that. <a href="mailto:hello@sonora.example" className="font-semibold text-[#e98068] underline decoration-[#e98068]/30 underline-offset-4" data-testid="link-faq-email">Say hello.</a></p></div></Reveal><Reveal delay={1}><div className="divide-y divide-[#19373a]/10">{[['Does Sonora record without me knowing?', 'No. Sonora only records when you explicitly start a session. You will always see when it is listening.'], ['What happens to my recordings?', 'Your audio is encrypted in transit and at rest. You can delete individual recordings or your full library whenever you want.'], ['Can I upload conversations I already have?', 'Yes. Bring an MP3, WAV, or M4A file and Sonora will prepare a searchable transcript and summary.'], ['Will Sonora work with my team?', 'Signal is designed for thoughtful teams. Shared briefs and a common searchable library are coming soon.']].map(([question, answer], index) => <details key={question} className="group py-5" data-testid={`faq-item-${index}`}><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-[#19373a]"><span>{question}</span><ChevronDown size={17} className="shrink-0 text-[#19373a]/45 transition group-open:rotate-180" /></summary><p className="max-w-[540px] pt-3 text-sm leading-6 text-[#19373a]/58">{answer}</p></details>)}</div></Reveal></div>
      </section>

      <footer className="bg-[#173438] px-5 pb-8 pt-16 text-[#fffdf7] sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[1240px]"><Reveal><div className="grid gap-12 border-b border-[#fffdf7]/12 pb-14 md:grid-cols-[1fr,1fr,.8fr]"><div><Logo light /><h2 className="sonora-display mt-8 max-w-[390px] text-5xl leading-[.94] tracking-[-.04em]">Make room for the good stuff.</h2><button className="sonora-button mt-7 flex items-center gap-2 rounded-xl bg-[#f0c76c] px-4 py-3 text-sm font-semibold text-[#19373a]" onClick={jumpToDemo} data-testid="button-footer-start">Try Sonora free <ArrowUpRight size={15} /></button></div><div className="grid grid-cols-2 gap-8 text-sm"><div><div className="eyebrow mb-4 text-[#fffdf7]/35">Explore</div><div className="space-y-3 text-[#fffdf7]/65"><a className="block transition hover:text-[#f0c76c]" href="#how-it-works" data-testid="link-footer-how">How it works</a><a className="block transition hover:text-[#f0c76c]" href="#use-cases" data-testid="link-footer-use">Use cases</a><a className="block transition hover:text-[#f0c76c]" href="#pricing" data-testid="link-footer-pricing">Pricing</a></div></div><div><div className="eyebrow mb-4 text-[#fffdf7]/35">Elsewhere</div><div className="space-y-3 text-[#fffdf7]/65"><a className="block transition hover:text-[#f0c76c]" href="mailto:hello@sonora.example" data-testid="link-footer-contact">Contact</a><a className="block transition hover:text-[#f0c76c]" href="#faq" data-testid="link-footer-faq">FAQ</a><a className="block transition hover:text-[#f0c76c]" href="#top" data-testid="link-footer-top">Back to top</a></div></div></div><div className="flex items-end text-sm text-[#fffdf7]/45"><p className="leading-6">The quiet advantage<br />in a noisy world.</p></div></div></Reveal><div className="flex flex-col justify-between gap-3 pt-6 text-[.65rem] text-[#fffdf7]/35 sm:flex-row"><span>© 2025 Sonora AI, Inc.</span><span>Made for conversations worth keeping.</span></div></div>
      </footer>
    </main>
  );
}

export default App;