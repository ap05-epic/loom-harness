import { useState, type ComponentType } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Check, ChevronDown, Moon, Sun } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { ExploreView } from './components/ExploreView';
import { Chat } from './components/Chat';
import { Baa } from './components/Baa';
import { Orchestration } from './components/Orchestration';
import { Onboarding } from './components/Onboarding';
import { ControlCenter } from './components/ControlCenter';
import { LoomMark } from './components/LoomMark';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { ProjectProvider } from './project';
import { fetchChatInfo, fetchProfiles, switchProfile } from './api';

const client = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 1000 } },
});

/** Light/dark toggle — flips `data-theme` on <html> and remembers it (default light, set in index.html). */
function ThemeToggle() {
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute('data-theme') || 'light',
  );
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('loom-theme', next);
    } catch {
      /* private mode — in-memory only */
    }
    setTheme(next);
  };
  return (
    <button
      onClick={toggle}
      className="btn"
      style={{ padding: '6px 9px' }}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle light/dark theme"
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

/**
 * A registered product surface. Adding a surface is one entry here, not a rewrite — the base (chat
 * loop, tools, permission gate, durable store, server) is shared.
 */
type Surface = { id: string; label: string; Component: ComponentType };

const SURFACES: Surface[] = [
  { id: 'dashboard', label: 'Dashboard', Component: Dashboard },
  { id: 'crawl', label: 'Live Crawl', Component: ExploreView },
  { id: 'agents', label: 'Agents', Component: Orchestration },
  { id: 'chat', label: 'Chat', Component: Chat },
  { id: 'baa', label: 'BAA', Component: Baa },
  { id: 'setup', label: 'Setup', Component: Onboarding },
  { id: 'settings', label: 'Settings', Component: ControlCenter },
];

/** The always-visible profile switcher — the active learning root + a one-click dropdown to switch. */
function ProfileChip() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isError } = useQuery({
    queryKey: ['profiles'],
    queryFn: fetchProfiles,
    refetchInterval: 5000,
  });
  const sw = useMutation({
    mutationFn: switchProfile,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profiles'] });
      void qc.invalidateQueries({ queryKey: ['chat-info'] });
      setOpen(false);
    },
  });
  if (isError || !data) return null; // chat not enabled → no profile chip
  return (
    <div className="relative">
      <button
        className="pill"
        style={{ cursor: 'pointer', padding: '4px 10px' }}
        title="Active profile — click to switch"
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="dot"
          style={{ background: 'var(--pass)', boxShadow: '0 0 6px var(--pass)' }}
        />
        <span className="mono">{data.active}</span>
        <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="card absolute top-full right-0 z-30 mt-1.5 w-60 p-1.5"
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="muted px-2 py-1 text-[11px] tracking-wide uppercase">Profile</div>
            {data.profiles.map((p) => (
              <button
                key={p.name}
                disabled={sw.isPending}
                onClick={() => sw.mutate(p.name)}
                className="flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-sm"
                style={{ background: p.active ? 'var(--accent-soft)' : 'transparent' }}
              >
                <span
                  className="mono"
                  style={{ color: p.active ? 'var(--accent)' : 'var(--text)' }}
                >
                  {p.name}
                </span>
                {p.active ? (
                  <Check size={14} style={{ color: 'var(--accent)' }} />
                ) : (
                  <span className="muted text-[11px]">{p.skills} skills</span>
                )}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button onClick={onClick} className={active ? 'tab tab-active' : 'tab'}>
      {children}
    </button>
  );
}

/** The brand lockup: the three-keys mark + the LOOM wordmark (mono, the weave feel) stacked over a
 *  small-caps "MISSION CONTROL". */
function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span style={{ color: 'var(--text)' }}>
        <LoomMark size={26} />
      </span>
      <div className="flex flex-col leading-none">
        <span
          className="mono text-[15px] font-bold"
          style={{ color: 'var(--text)', letterSpacing: '0.22em' }}
        >
          LOOM
        </span>
        <span
          className="mono mt-1 text-[9px]"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.26em' }}
        >
          MISSION CONTROL
        </span>
      </div>
    </div>
  );
}

function TopBar({ view, onView }: { view: string; onView: (v: string) => void }) {
  return (
    <header
      className="sticky top-0 z-20"
      style={{
        background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <div className="mx-auto flex max-w-[1500px] items-center gap-5 px-5 py-3">
        <Brand />
        <nav className="ml-2 flex gap-1">
          {SURFACES.map((s) => (
            <NavButton key={s.id} active={view === s.id} onClick={() => onView(s.id)}>
              {s.label}
            </NavButton>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ProfileChip />
          <ThemeToggle />
          <ProjectSwitcher />
        </div>
      </div>
      <div className="weave-divider" />
    </header>
  );
}

/** When the project isn't configured (no model/profile → chat 503s), guide the user to Setup. */
function SetupBanner({ onSetup }: { onSetup: () => void }) {
  const { isError, isLoading } = useQuery({
    queryKey: ['chat-info'],
    queryFn: fetchChatInfo,
    retry: false,
  });
  if (isLoading || !isError) return null; // configured (chat enabled) → nothing to nag about
  return (
    <div
      className="mx-auto mt-3 flex max-w-[1500px] flex-wrap items-center gap-3 rounded-[10px] px-4 py-2.5"
      style={{
        background: 'var(--accent-soft)',
        border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border))',
      }}
    >
      <span className="text-sm">
        <b>Loom isn’t set up yet.</b>{' '}
        <span className="muted">
          Configure your pod to enable Chat, the pipeline, and profiles.
        </span>
      </span>
      <button className="btn btn-accent ml-auto" onClick={onSetup}>
        Open Setup
      </button>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<string>('dashboard');
  const active = SURFACES.find((s) => s.id === view) ?? SURFACES[0]!;
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <div className="min-h-full">
          <TopBar view={view} onView={setView} />
          <SetupBanner onSetup={() => setView('setup')} />
          {/* `key` re-mounts on surface switch → the staggered reveal plays each time. */}
          <main key={view} className="reveal mx-auto max-w-[1500px] px-5 py-5">
            <active.Component />
          </main>
        </div>
      </ProjectProvider>
    </QueryClientProvider>
  );
}
