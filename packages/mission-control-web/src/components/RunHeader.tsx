import type { ReactNode } from 'react';
import type { RunInfo } from '../api';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="muted text-xs uppercase tracking-wide">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s === 'running') return 'var(--info)';
  if (s === 'done' || s === 'finished' || s === 'passed') return 'var(--pass)';
  if (s === 'failed' || s === 'error') return 'var(--fail)';
  return 'var(--text-muted)';
}

/** The run header strip: which project/run is active, its status and stage. */
export function RunHeader({ run }: { run: RunInfo | null }) {
  if (!run) {
    return (
      <div className="card px-4 py-3">
        <span className="muted text-sm">
          No active run — start one with <code className="mono">loom run</code> or{' '}
          <code className="mono">loom explore</code>.
        </span>
      </div>
    );
  }
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="text-lg font-semibold" style={{ color: 'var(--accent)' }}>
        {run.project}
      </div>
      <Field label="run">
        <span className="mono">{run.id.slice(0, 12)}</span>
      </Field>
      <Field label="status">
        <span style={{ color: statusTone(run.status) }}>{run.status}</span>
      </Field>
      {run.stage && <Field label="stage">{run.stage}</Field>}
      {run.harnessVersion && <Field label="version">v{run.harnessVersion}</Field>}
    </div>
  );
}
