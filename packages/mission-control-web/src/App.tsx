import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './components/Dashboard';
import { ExploreView } from './components/ExploreView';

const client = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 1000 } },
});

type View = 'dashboard' | 'crawl';

/** The Loom Mission Control mark — the woven grid, rendered small in the top bar. */
function Mark() {
  return (
    <span
      className="mono leading-[0.8]"
      style={{ color: 'var(--accent)', fontSize: 10 }}
      aria-hidden
    >
      │┼│
    </span>
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
    <button
      onClick={onClick}
      className="rounded px-2.5 py-1 text-sm"
      style={{
        color: active ? 'var(--text)' : 'var(--text-muted)',
        background: active ? 'var(--surface-raised)' : 'transparent',
        border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
      }}
    >
      {children}
    </button>
  );
}

function TopBar({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <header
      className="flex items-center gap-3 border-b px-4 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <Mark />
      <span className="font-semibold tracking-wide">LOOM</span>
      <span className="muted text-sm">Mission Control</span>
      <nav className="ml-4 flex gap-1">
        <NavButton active={view === 'dashboard'} onClick={() => onView('dashboard')}>
          Dashboard
        </NavButton>
        <NavButton active={view === 'crawl'} onClick={() => onView('crawl')}>
          Live Crawl
        </NavButton>
      </nav>
    </header>
  );
}

export function App() {
  const [view, setView] = useState<View>('dashboard');
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-full">
        <TopBar view={view} onView={setView} />
        <main className="mx-auto max-w-[1400px] px-4 py-4">
          {view === 'dashboard' ? <Dashboard /> : <ExploreView />}
        </main>
      </div>
    </QueryClientProvider>
  );
}
