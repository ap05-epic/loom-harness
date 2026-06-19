import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { LoomMark } from './LoomMark';

/** The setup inputs the wizard collects, then turns into a config + pod commands. */
type Data = {
  projectName: string;
  appType: string;
  baseUrl: string;
  startPath: string;
  provider: string;
  model: string;
  apiKeyEnv: string;
  baseUrlEnv: string;
};

const STEPS = ['Welcome', 'Prerequisites', 'Legacy app', 'Model', 'Review'];

const PREREQS = [
  {
    k: 'node',
    label: 'Node.js 20+ and pnpm',
    detail: 'the harness runs on Node; pnpm installs it',
  },
  {
    k: 'app',
    label: 'The legacy app reachable from your pod',
    detail: 'e.g. running at localhost:8080 — Loom drives it to capture ground truth',
  },
  {
    k: 'model',
    label: 'A model endpoint + API key',
    detail:
      'OpenAI / Azure / Anthropic — supplied via an environment variable, never typed into a UI',
  },
  {
    k: 'git',
    label: 'A git workspace for the rebuilt code',
    detail: 'Loom writes the modern React output here',
  },
];

function genConfig(d: Data): string {
  const lines = [
    `project: ${d.projectName || 'my-app'}`,
    `llm:`,
    `  driver: ${d.provider}`,
    `  model: ${d.model || 'gpt-5.4'}`,
    `  apiKeyEnv: ${d.apiKeyEnv || 'OPENAI_API_KEY'}`,
  ];
  if (d.baseUrlEnv.trim()) lines.push(`  baseUrlEnv: ${d.baseUrlEnv}`);
  lines.push(`source:`, `  type: ${d.appType}`);
  if (d.baseUrl.trim()) lines.push(`  baseUrl: ${d.baseUrl}`);
  if (d.startPath.trim()) lines.push(`  startPath: ${d.startPath}`);
  return lines.join('\n');
}

function genCommands(d: Data): string {
  return [
    '# In your pod, from the project directory:',
    `export ${d.apiKeyEnv || 'OPENAI_API_KEY'}=<your-api-key>`,
    ...(d.baseUrlEnv.trim() ? [`export ${d.baseUrlEnv}=<your-endpoint-url>`] : []),
    '',
    'loom map        # understand the legacy app',
    'loom run        # rebuild each screen + verify parity',
    'loom ui         # open this Mission Control',
  ].join('\n');
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center gap-1">
            <div className="flex items-center gap-2">
              <span
                className="mono flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
                style={{
                  background: done || active ? 'var(--accent)' : 'var(--surface-raised)',
                  color: done || active ? 'var(--on-accent)' : 'var(--text-muted)',
                  border: `1px solid ${done || active ? 'var(--accent)' : 'var(--border-strong)'}`,
                }}
              >
                {done ? <Check size={13} /> : i + 1}
              </span>
              <span
                className="hidden text-xs font-medium sm:inline"
                style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 ? (
              <span
                className="mx-1 h-px w-6"
                style={{ background: done ? 'var(--accent)' : 'var(--border-strong)' }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      <input
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className="muted text-[11px]">{hint}</span> : null}
    </label>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is selectable anyway */
    }
  };
  return (
    <div className="relative">
      <pre
        className="mono overflow-auto rounded-[8px] p-3 text-xs"
        style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}
      >
        {text}
      </pre>
      <button className="btn absolute top-2 right-2" style={{ padding: '4px 8px' }} onClick={copy}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** The onboarding wizard: a guided "set up Loom in your pod" flow that ends in a ready-to-use
 * config + the exact commands to run. Self-contained (no backend) — it produces the artifacts the
 * operator drops into their pod. */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Data>({
    projectName: '',
    appType: 'struts',
    baseUrl: '',
    startPath: '',
    provider: 'openai',
    model: 'gpt-5.4',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrlEnv: 'OPENAI_BASE_URL',
  });
  const set = (k: keyof Data) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const config = useMemo(() => genConfig(d), [d]);
  const commands = useMemo(() => genCommands(d), [d]);
  const last = STEPS.length - 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="card flex flex-col gap-5 p-6">
        <Stepper step={step} />
        <div className="weave-divider" />

        {step === 0 ? (
          <div className="reveal flex flex-col items-center gap-4 py-6 text-center">
            <div style={{ color: 'var(--text)' }}>
              <LoomMark size={52} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Set up Loom in your pod</h1>
              <p className="muted mx-auto mt-2 max-w-md text-sm">
                Loom maps your undocumented legacy app, rebuilds its screens in modern React, and
                proves each rebuild is identical to the original. This guide gets it running in five
                short steps.
              </p>
            </div>
            <div className="flex gap-6 text-sm">
              {['Map', 'Rebuild', 'Verify'].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="dot" style={{ background: 'var(--accent)' }} />
                  <span className="mono text-xs">
                    {i + 1}. {s}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="reveal flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Before you start</h2>
            <p className="muted text-sm">
              Make sure your pod has these. No action here — just a checklist.
            </p>
            <ul className="flex flex-col gap-2">
              {PREREQS.map((p) => (
                <li key={p.k} className="card-raised flex items-start gap-3 p-3">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <Check size={13} />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="muted text-xs">{p.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="reveal flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Your legacy app</h2>
            <Field
              label="Project name"
              value={d.projectName}
              onChange={set('projectName')}
              placeholder="my-app"
              hint="A short slug — becomes the project + config name."
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">App framework</span>
              <select
                className="field"
                value={d.appType}
                onChange={(e) => set('appType')(e.target.value)}
              >
                <option value="struts">Struts</option>
                <option value="jsp">JSP / Servlets</option>
                <option value="jsf">JSF</option>
                <option value="other">Other / mixed</option>
              </select>
            </label>
            <Field
              label="Base URL (in your pod)"
              value={d.baseUrl}
              onChange={set('baseUrl')}
              placeholder="http://localhost:8080/app"
              hint="Where the running legacy app is reachable. Loom drives it to capture ground truth."
            />
            <Field
              label="Start path (optional)"
              value={d.startPath}
              onChange={set('startPath')}
              placeholder="jsp/login.jsp"
              hint="The entry screen the crawl should begin from."
            />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="reveal flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Model</h2>
            <p className="muted text-sm">
              The agent's brain. Your key stays a pod environment variable — never entered here.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Provider</span>
              <select
                className="field"
                value={d.provider}
                onChange={(e) => set('provider')(e.target.value)}
              >
                <option value="openai">OpenAI / Azure (OpenAI-compatible)</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>
            <Field label="Model id" value={d.model} onChange={set('model')} placeholder="gpt-5.4" />
            <Field
              label="API-key env var"
              value={d.apiKeyEnv}
              onChange={set('apiKeyEnv')}
              placeholder="OPENAI_API_KEY"
              hint="Loom reads the key from this variable at runtime."
            />
            <Field
              label="Base-URL env var (optional)"
              value={d.baseUrlEnv}
              onChange={set('baseUrlEnv')}
              placeholder="OPENAI_BASE_URL"
              hint="For Azure / self-hosted endpoints. Leave the default for public OpenAI."
            />
          </div>
        ) : null}

        {step === last ? (
          <div className="reveal flex flex-col gap-4">
            <h2 className="text-lg font-semibold">You're ready</h2>
            <p className="muted text-sm">
              Drop this <span className="mono">loom.config.yaml</span> in your project directory,
              then run the commands. That's the whole setup.
            </p>
            <div>
              <div className="mb-1.5 text-xs font-medium">loom.config.yaml</div>
              <CopyBlock text={config} />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium">Run in your pod</div>
              <CopyBlock text={commands} />
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between pt-1">
          <button
            className="btn"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          <span className="muted text-xs">
            Step {step + 1} of {STEPS.length}
          </span>
          {step < last ? (
            <button
              className="btn btn-accent"
              onClick={() => setStep((s) => Math.min(last, s + 1))}
            >
              Continue
            </button>
          ) : (
            <button className="btn btn-accent" onClick={() => setStep(0)}>
              Start over
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
