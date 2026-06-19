import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChatInfo, fetchInventory, fetchProfiles, switchProfile } from '../api';
import { useProject } from '../project';

const TABS = ['Profiles', 'Skills', 'Preferences', 'About'] as const;
type Tab = (typeof TABS)[number];

/** Switch the profile learning root (memory + skills), Hermes-style — no restart. */
function ProfilesTab() {
  const qc = useQueryClient();
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
    },
  });
  if (isError)
    return (
      <p className="muted text-sm">
        Profiles need a configured project — start <span className="mono">loom ui</span> from one.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="muted text-sm">
        A profile is a shared learning root — its memory and accumulated skills load with no
        restart. Switching is like “start fresh for a new use case”; per-project data stays
        separate.
      </p>
      <div className="flex flex-col gap-2">
        {(data?.profiles ?? []).map((p) => (
          <div
            key={p.name}
            className="card-raised flex items-center justify-between p-3"
            style={{ borderColor: p.active ? 'var(--accent)' : 'var(--border)' }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="dot"
                style={{
                  background: p.active ? 'var(--pass)' : 'var(--text-muted)',
                  boxShadow: p.active ? '0 0 6px var(--pass)' : undefined,
                }}
              />
              <div>
                <div className="text-sm font-medium">
                  <span className="mono">{p.name}</span>
                  {p.configured ? <span className="muted text-xs"> · default</span> : null}
                </div>
                <div className="muted text-xs">
                  {p.skills} skill{p.skills === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            {p.active ? (
              <span
                className="pill"
                style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
              >
                active
              </span>
            ) : (
              <button className="btn" disabled={sw.isPending} onClick={() => sw.mutate(p.name)}>
                Switch
              </button>
            )}
          </div>
        ))}
        {data && data.profiles.length === 0 ? (
          <span className="muted text-xs">No profiles yet.</span>
        ) : null}
      </div>
    </div>
  );
}

/** Browse the agent's skills (built-in conversion + accumulated), searchable, grouped by tier. */
function SkillsTab() {
  const { project } = useProject();
  const [query, setQuery] = useState('');
  const { data } = useQuery({
    queryKey: ['inventory', project],
    queryFn: () => fetchInventory(project),
  });
  const all = data?.skills ?? [];
  const skills = all.filter((s) =>
    `${s.name} ${s.description} ${s.tier}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-3">
      <input
        className="field"
        placeholder="Search skills…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {skills.length === 0 ? (
        <p className="muted text-sm">{all.length === 0 ? 'No skills yet.' : 'No matches.'}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {skills.map((s) => (
            <div key={`${s.source}:${s.name}`} className="card-raised p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="mono text-sm font-medium">{s.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="pill" style={{ fontSize: 11 }}>
                    {s.tier}
                  </span>
                  {s.status !== 'active' ? (
                    <span className="pill" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {s.status}
                    </span>
                  ) : null}
                </div>
              </div>
              {s.description ? <div className="muted mt-1 text-xs">{s.description}</div> : null}
              {s.useCount > 0 ? (
                <div className="muted mt-1 text-[11px]">
                  used {s.useCount}× · {s.successCount} passed
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="inline-flex rounded-[8px] p-0.5"
      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="rounded-[6px] px-3 py-1 text-xs font-medium"
          style={{
            background: value === o.value ? 'var(--surface)' : 'transparent',
            color: value === o.value ? 'var(--accent)' : 'var(--text-muted)',
            boxShadow: value === o.value ? 'var(--shadow-sm)' : undefined,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="muted text-xs">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Read a local preference (theme is applied via index.html; others are read by the surfaces). */
function getPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function setPref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function PreferencesTab() {
  const [theme, setThemeState] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light',
  );
  const [sendKey, setSendKey] = useState(() => getPref('loom-send-key', 'enter'));
  const setTheme = (t: string) => {
    document.documentElement.setAttribute('data-theme', t);
    setPref('loom-theme', t);
    setThemeState(t);
  };
  return (
    <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
      <Row label="Theme" hint="The whole interface, light or dark.">
        <Segmented
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>
      <Row label="Send message with" hint="How the chat composer submits.">
        <Segmented
          value={sendKey}
          onChange={(v) => {
            setSendKey(v);
            setPref('loom-send-key', v);
          }}
          options={[
            { value: 'enter', label: 'Enter' },
            { value: 'mod-enter', label: 'Ctrl+Enter' },
          ]}
        />
      </Row>
    </div>
  );
}

function AboutTab() {
  const { data } = useQuery({ queryKey: ['chat-info'], queryFn: fetchChatInfo });
  const rows: Array<[string, string]> = [
    ['Product', 'Loom Harness'],
    ['Tagline', 'legacy UI, rebuilt faithfully'],
    ['Model', data ? `${data.driver}/${data.model}` : '…'],
    ['Active profile', data?.profile ?? '—'],
    ['Project', data?.project ?? '—'],
  ];
  return (
    <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between py-2.5">
          <span className="muted text-sm">{k}</span>
          <span className="mono text-sm">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** The Control Center — profiles, skills, preferences, and about, in one Hermes-style settings hub. */
export function ControlCenter() {
  const [tab, setTab] = useState<Tab>('Profiles');
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Control Center</h1>
        <p className="muted text-sm">Profiles, skills, and preferences — your harness, your way.</p>
      </div>
      <div className="card flex flex-col gap-4 p-5">
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              className={tab === t ? 'tab tab-active' : 'tab'}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="weave-divider" />
        <div className="reveal">
          {tab === 'Profiles' ? (
            <ProfilesTab />
          ) : tab === 'Skills' ? (
            <SkillsTab />
          ) : tab === 'Preferences' ? (
            <PreferencesTab />
          ) : (
            <AboutTab />
          )}
        </div>
      </div>
    </div>
  );
}
