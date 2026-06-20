import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { createProject } from '../api';
import { genConfig, looksLikeValueNotName, type SetupData } from '../lib/setup-config';
import { LoomMark } from './LoomMark';

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
    label: 'A model endpoint + API key in the environment',
    detail: 'set on the pod (LLM_API_KEY / LLM_BASE_URL) by `loom init` — never typed into this UI',
  },
  {
    k: 'git',
    label: 'A git workspace for the rebuilt code',
    detail: 'Loom writes the modern React output here',
  },
];

/** An env-var-NAME field that warns inline if the user pastes the actual secret/URL instead. */
function EnvVarField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const warn = looksLikeValueNotName(value);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      <input
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={warn ? { borderColor: 'var(--fail)' } : undefined}
      />
      {warn ? (
        <span className="text-[11px]" style={{ color: 'var(--fail)' }}>
          That looks like the actual value. Enter the variable <b>name</b> (e.g.{' '}
          <span className="mono">LLM_API_KEY</span>) — your secret stays in the pod environment,
          never in this file.
        </span>
      ) : (
        <span className="muted text-[11px]">
          The <b>name</b> of the env var Loom reads at runtime — not the value.
        </span>
      )}
    </label>
  );
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

/** The onboarding wizard: a guided "set up Loom in your pod" flow that ends by **saving** the project's
 * loom.config.yaml for you (no hand-placing a file) — then you just restart Loom. */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [d, setD] = useState<SetupData>({
    projectName: '',
    appType: 'struts',
    strutsConfig: '',
    baseUrl: '',
    startPath: '/',
    provider: 'openai',
    model: 'gpt-5.4',
    apiKeyEnv: 'LLM_API_KEY',
    baseUrlEnv: 'LLM_BASE_URL',
  });
  const set = (k: keyof SetupData) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const config = useMemo(() => genConfig(d), [d]);
  const create = useMutation({ mutationFn: () => createProject(config) });
  const last = STEPS.length - 1;
  // A failed save with a 404/405 means the running server predates /api/setup — i.e. `loom update`
  // ran but the live `loom` wasn't restarted. Detect it so we can tell the user exactly that.
  const staleServer = create.error instanceof Error && /\b(404|405)\b/.test(create.error.message);

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
              <h1 className="text-2xl font-bold">Set up your project</h1>
              <p className="muted mx-auto mt-2 max-w-md text-sm">
                Tell Loom a few things about your legacy app and it'll save the project for you —
                then map the app, rebuild its screens in modern React, and prove each rebuild
                matches the original.
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
            <p className="muted text-sm">A quick checklist — nothing to do here.</p>
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
              placeholder="BAA-Test-2"
              hint="A short name — this is what shows up across Mission Control."
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
              label="Path to struts-config.xml (on the pod)"
              value={d.strutsConfig}
              onChange={set('strutsConfig')}
              placeholder="./app/WEB-INF/struts-config.xml"
              hint="The legacy source map reads this to find every screen. Optional now — add it before you run MAP."
            />
            <Field
              label="App base URL (where it runs in your pod)"
              value={d.baseUrl}
              onChange={set('baseUrl')}
              placeholder="http://localhost:8080/app"
              hint="The running legacy app Loom drives to capture ground truth."
            />
            <Field
              label="Start path"
              value={d.startPath}
              onChange={set('startPath')}
              placeholder="/"
              hint="The entry screen the crawl begins from."
            />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="reveal flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Model</h2>
            <div
              className="rounded-[8px] p-3 text-sm"
              style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)' }}
            >
              Your API key + endpoint are <b>already set in the pod environment</b> (
              <span className="mono">LLM_API_KEY</span> / <span className="mono">LLM_BASE_URL</span>
              , from <span className="mono">loom init</span>). Loom uses those —{' '}
              <b>don't paste your key or URL here.</b>
            </div>
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
            <button
              type="button"
              className="muted self-start text-xs underline"
              onClick={() => setAdvanced((a) => !a)}
            >
              {advanced ? 'Hide advanced' : 'Advanced — environment variable names'}
            </button>
            {advanced ? (
              <div className="flex flex-col gap-4">
                <p className="muted text-xs">
                  Only change these if your pod names the variables differently than the defaults.
                </p>
                <EnvVarField
                  label="API-key env var name"
                  value={d.apiKeyEnv}
                  onChange={set('apiKeyEnv')}
                  placeholder="LLM_API_KEY"
                />
                <EnvVarField
                  label="Base-URL env var name"
                  value={d.baseUrlEnv}
                  onChange={set('baseUrlEnv')}
                  placeholder="LLM_BASE_URL"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {step === last ? (
          <div className="reveal flex flex-col gap-4">
            {create.isSuccess ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Check size={26} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold">Project saved</h2>
                  <p className="muted mt-1 text-sm">
                    Written to <span className="mono">{create.data.path}</span>.
                  </p>
                </div>
                <div className="card-raised w-full max-w-md p-4 text-left">
                  <div className="text-sm font-medium">One last step — restart Loom:</div>
                  <ol className="muted mt-1.5 list-decimal pl-5 text-xs leading-relaxed">
                    <li>
                      In the terminal running Loom, press <span className="mono">Ctrl-C</span>.
                    </li>
                    <li>
                      Type <span className="mono">loom</span> and press Enter.
                    </li>
                    <li>
                      Refresh this page —{' '}
                      <span className="mono">{d.projectName || 'your project'}</span> will be live.
                    </li>
                  </ol>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Review &amp; create</h2>
                <p className="muted text-sm">
                  This saves the config below as your project — no files to move. Your model + key
                  are read from the pod environment.
                </p>
                <div>
                  <div className="mb-1.5 text-xs font-medium">loom.config.yaml</div>
                  <CopyBlock text={config} />
                </div>
                {create.isError ? (
                  <div
                    className="rounded-[8px] p-3 text-sm"
                    style={{
                      color: 'var(--fail)',
                      background: 'color-mix(in srgb, var(--fail) 8%, var(--surface))',
                      border: '1px solid color-mix(in srgb, var(--fail) 35%, var(--border))',
                    }}
                  >
                    {staleServer ? (
                      <>
                        <b>Your running Loom is out of date.</b> You updated, but the live server
                        started before this button existed. In your terminal: press{' '}
                        <span className="mono">Ctrl-C</span>, type{' '}
                        <span className="mono">loom</span>, reload this page, then click Create
                        again.
                      </>
                    ) : (
                      <>
                        Couldn't save:{' '}
                        {create.error instanceof Error
                          ? create.error.message
                          : String(create.error)}
                        . You can still copy the config above into{' '}
                        <span className="mono">~/.loom/loom.config.yaml</span> and restart Loom.
                      </>
                    )}
                  </div>
                ) : null}
                <button
                  className="btn btn-accent justify-center"
                  disabled={create.isPending || !d.projectName.trim()}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? 'Creating…' : `Create ${d.projectName.trim() || 'project'}`}
                </button>
                {!d.projectName.trim() ? (
                  <span className="muted text-center text-xs">
                    Give your project a name first (step 3).
                  </span>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {!create.isSuccess ? (
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
              <span style={{ width: 1 }} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
