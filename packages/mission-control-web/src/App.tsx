import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './components/Dashboard';

const client = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 1000 } },
});

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

function TopBar() {
  return (
    <header
      className="flex items-center gap-3 border-b px-4 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <Mark />
      <span className="font-semibold tracking-wide">LOOM</span>
      <span className="muted text-sm">Mission Control</span>
    </header>
  );
}

export function App() {
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-full">
        <TopBar />
        <main className="mx-auto max-w-[1400px] px-4 py-4">
          <Dashboard />
        </main>
      </div>
    </QueryClientProvider>
  );
}
