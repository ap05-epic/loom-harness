import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OpenAiDriver } from '@loom/agents';
import { captureDom, captureScreenshot, DEFAULT_VIEWPORT, type DomSnapshot } from '@loom/browser';
import { discoverLegacyWebapp, mapProject, openCodeAtlas } from '@loom/cartographer';
import { checkParity } from './check.js';
import { doLogin, loginAndCapture, looksLikeFailure, type LoginField } from './login.js';
import { legacyNavTargets, normalizePath } from './paths.js';
import { diffsForLlm, printReport } from './report.js';
import { runReplicate } from './run.js';

/** Read `--name value`. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
/** Read a boolean `--flag`. */
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Build the login fields from env (BAA_USER / BAA_PASS / BAA_FA) + configurable selectors. */
function loginFieldsFromEnv(): LoginField[] {
  const fields: LoginField[] = [];
  if (process.env.BAA_USER)
    fields.push({ selector: arg('user-sel') ?? 'input[type=text]', value: process.env.BAA_USER });
  if (process.env.BAA_PASS)
    fields.push({
      selector: arg('pass-sel') ?? 'input[type=password]',
      value: process.env.BAA_PASS,
    });
  const fa = process.env.BAA_FA;
  const faSel = arg('fa-sel');
  if (fa && faSel) fields.push({ selector: faSel, value: fa });
  return fields;
}

const MAP_USAGE = 'usage: replicate map --struts <struts-config.xml> --out <codeatlas.db>';
const LOGIN_USAGE =
  'usage: replicate login --legacy <loginUrl> [--out .loom/auth.json] [--user-sel <css>] [--pass-sel <css>] ' +
  '[--fa-sel <css>] [--submit-sel <css>] [--success-sel <css>]  (creds from env: BAA_USER, BAA_PASS, BAA_FA)';
const SHOT_USAGE =
  'usage: replicate shot --legacy <url> [--login <loginUrl> (live login, creds from env) | --storage <auth.json>] [--out .loom/shots/probe.png]';
const CHECK_USAGE =
  'usage: replicate check --legacy <url> --replica <url> [--atlas <codeatlas.db> --screen <key>] [--storage <auth.json>] [--threshold 1] [--visual-gate] [--llm-diff]';
const RUN_USAGE =
  'usage: replicate run --screen <key> --atlas <codeatlas.db> --app <reactAppDir> ' +
  '(--legacy <url> | --login <loginUrl> [--legacy <post-login target>]) ' +
  '[--webapp <dir>] [--build "npx vite build"] [--serve dist] [--route /] ' +
  '[--component src/App.tsx] [--threshold 1] [--max-iterations 12] [--visual-gate] [--shots .loom/shots | --no-shots] [--model gpt-5.4]';

/**
 * `replicate map` — deterministically map the legacy app from its struts-config (auto-discovering the
 * sibling Tiles/web.xml + every JSP) into a CodeAtlas, and print the screen inventory + routes. No
 * model, no profile system. This is the "here's the whole app" view + the atlas `run`/`check` consume.
 */
function map(): number {
  const struts = arg('struts');
  const out = arg('out');
  if (!struts || !out) {
    console.error(MAP_USAGE);
    return 2;
  }
  mkdirSync(dirname(out), { recursive: true }); // so `--out .loom/atlas.db` works without a pre-made dir
  const d = discoverLegacyWebapp(struts);
  const atlas = mapProject({
    atlasPath: out,
    strutsConfigPath: d.strutsConfigPath,
    tilesDefsPath: d.tilesDefsPath,
    webXmlPath: d.webXmlPath,
    jsps: d.jsps,
  });
  try {
    const screens = atlas.screens();
    console.log(`✓ mapped ${screens.length} screen(s) · ${d.jsps.length} JSP(s) → ${out}\n`);
    for (const s of screens) {
      const routes = [
        ...new Set(legacyNavTargets(atlas, s.key).map(normalizePath).filter(Boolean)),
      ];
      console.log(`  ${s.key}  (${s.actionPath})`);
      if (s.viewJsps.length) console.log(`    views:  ${s.viewJsps.join(', ')}`);
      if (routes.length) console.log(`    routes: ${routes.join(', ')}`);
    }
    return 0;
  } finally {
    atlas.close();
  }
}

/** Flatten a DOM snapshot to its visible text — for identifying a page from the terminal. */
function collectText(node: DomSnapshot): string {
  const parts: string[] = [];
  const visit = (n: DomSnapshot): void => {
    if (n.text) parts.push(n.text);
    for (const c of n.children) visit(c);
  };
  visit(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * `replicate shot` — screenshot a URL (with an optional saved session) and print its visible text, so
 * you can identify a page from the terminal without a browser. No model. Great for finding the right
 * post‑login URLs (which one is the dashboard vs an error page).
 */
async function shot(): Promise<number> {
  const out = arg('out') ?? '.loom/shots/probe.png';
  mkdirSync(dirname(out), { recursive: true });

  // `--login <loginUrl>`: log in and (optionally) navigate to a target in ONE live session — what BAA
  // needs (a restored cookie won't survive a cold request). Omit --legacy to capture the landing page.
  const loginUrl = arg('login');
  if (loginUrl) {
    const fields = loginFieldsFromEnv();
    if (fields.length === 0) {
      console.error('set BAA_USER and BAA_PASS in the environment to use --login.');
      return 2;
    }
    const { screenshot, text, finalUrl } = await loginAndCapture({
      loginUrl,
      targetUrl: arg('legacy'),
      fields,
      submitSelector: arg('submit-sel') ?? 'input[type=submit], button[type=submit]',
      successSelector: arg('success-sel'),
      waitMs: arg('wait-ms') ? Number(arg('wait-ms')) : undefined,
      onLog: (m) => console.error(m),
    });
    writeFileSync(out, screenshot);
    console.log(
      `✓ ${arg('legacy') ?? 'post-login landing'}  (via live login; ended at ${finalUrl})`,
    );
    console.log(`  screenshot → ${out}`);
    console.log(`  page text  : ${text.slice(0, 600) || '(no visible text — likely a FRAMESET)'}`);
    console.log(
      looksLikeFailure(text)
        ? '  ⚠ still a login/error/timeout page — a plain GET to this URL is not enough.'
        : '  ✓ looks like a real screen — this works after a live login.',
    );
    return 0;
  }

  const legacy = arg('legacy');
  if (!legacy) {
    console.error(SHOT_USAGE);
    return 2;
  }
  const storage = arg('storage');
  const auth = storage ? { storageStatePath: storage } : {};
  const [dom, png] = await Promise.all([
    captureDom({ url: legacy, viewport: DEFAULT_VIEWPORT, ...auth }),
    captureScreenshot({ url: legacy, viewport: DEFAULT_VIEWPORT, ...auth }),
  ]);
  writeFileSync(out, png);
  const text = collectText(dom).slice(0, 600);
  console.log(`✓ ${legacy}`);
  console.log(`  screenshot → ${out}`);
  console.log(
    `  page text  : ${text || '(no visible text in <body> — likely a FRAMESET; the real content is in child frames)'}`,
  );
  return 0;
}

/**
 * `replicate login` — log into the legacy app once (creds from env) and save the session to
 * `--out`, so `run`/`check` can reach post‑login screens via `--storage`. Field selectors are
 * configurable; print what it filled so you can adjust. No LLM.
 */
async function login(): Promise<number> {
  const legacy = arg('legacy');
  if (!legacy) {
    console.error(LOGIN_USAGE);
    return 2;
  }
  const out = arg('out') ?? '.loom/auth.json';
  const fields = loginFieldsFromEnv();
  if (fields.length === 0) {
    console.error(
      'set BAA_USER and BAA_PASS in the environment (and BAA_FA with --fa-sel for the FA number).',
    );
    return 2;
  }
  mkdirSync(dirname(out), { recursive: true });
  try {
    const { landedUrl, looksFailed } = await doLogin({
      loginUrl: legacy,
      outPath: out,
      fields,
      submitSelector: arg('submit-sel') ?? 'input[type=submit], button[type=submit]',
      successSelector: arg('success-sel'),
      waitMs: arg('wait-ms') ? Number(arg('wait-ms')) : undefined,
      onLog: (m) => console.error(m),
    });
    if (looksFailed) {
      console.log(`✗ login appears to have FAILED (landed at ${landedUrl} on a login/error page).`);
      console.log(
        '  the session was still saved, but it is NOT authenticated. See "page says:" above.',
      );
      return 1;
    }
    console.log(`✓ logged in (landed at ${landedUrl}); session saved → ${out}`);
    console.log(`  reuse it on any post-login screen with:  --storage ${out}`);
    return 0;
  } catch (e) {
    console.error(`login failed: ${e instanceof Error ? e.message : String(e)}`);
    console.error(
      'tip: open the login page and check the field selectors; pass --user-sel/--pass-sel/--fa-sel/--submit-sel to match.',
    );
    return 1;
  }
}

/**
 * `replicate check` — deterministically compare a built React replica against the live legacy screen
 * (visual + DOM + style + forms + path/route) and print the exact differences. No LLM. Exit 0 = 1:1.
 */
async function check(): Promise<number> {
  const legacy = arg('legacy');
  const replica = arg('replica');
  if (!legacy || !replica) {
    console.error(CHECK_USAGE);
    return 2;
  }
  const atlasPath = arg('atlas');
  const screen = arg('screen');
  const threshold = arg('threshold') ? Number(arg('threshold')) : 1;
  const atlas = atlasPath ? openCodeAtlas(atlasPath) : undefined;
  console.error(`▶ checking ${screen ?? 'screen'} — legacy ${legacy}  vs  replica ${replica}`);
  try {
    const report = await checkParity({
      legacyUrl: legacy,
      replicaUrl: replica,
      threshold,
      atlas,
      screenKey: screen,
      storageStatePath: arg('storage'),
      gate: has('visual-gate') ? 'visual' : 'strict',
    });
    console.log(printReport(report));
    if (!report.matched && has('llm-diff')) {
      console.log('\n--- differences for the model to fix ---');
      console.log(diffsForLlm(report));
    }
    return report.matched ? 0 : 1;
  } finally {
    atlas?.close();
  }
}

/**
 * `replicate run` — the full build→check→fix loop for one screen. The model (gpt‑5.4 via
 * LLM_BASE_URL + LLM_API_KEY) writes/fixes the React; the deterministic checker judges; it loops
 * until 1:1 or the cap. Exit 0 = 1:1.
 */
async function run(): Promise<number> {
  const screen = arg('screen');
  const atlasPath = arg('atlas');
  const legacy = arg('legacy');
  const app = arg('app');
  const loginUrl = arg('login');
  if (!screen || !atlasPath || !app || (!legacy && !loginUrl)) {
    console.error(RUN_USAGE);
    return 2;
  }
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || !baseUrl) {
    console.error(
      'set LLM_BASE_URL (…/openai/v1) and LLM_API_KEY in the environment (the gpt‑5.4 connection).',
    );
    return 2;
  }
  const webapp = arg('webapp');
  const jspSource = webapp
    ? (logicalPath: string): string | undefined => {
        try {
          return readFileSync(join(webapp, logicalPath), 'utf8');
        } catch {
          return undefined;
        }
      }
    : undefined;

  const atlas = openCodeAtlas(atlasPath);
  try {
    const result = await runReplicate({
      atlas,
      screenKey: screen,
      legacyUrl: legacy ?? loginUrl!,
      appDir: app,
      gateway: new OpenAiDriver({ baseUrl, apiKey }),
      model: arg('model') ?? process.env.LLM_MODEL ?? 'gpt-5.4',
      buildCmd: arg('build'),
      serveSubdir: arg('serve'),
      route: arg('route'),
      componentPath: arg('component'),
      jspSource,
      threshold: arg('threshold') ? Number(arg('threshold')) : 1,
      maxIterations: arg('max-iterations') ? Number(arg('max-iterations')) : 12,
      storageStatePath: arg('storage'),
      // Live-login capture (BAA): log in + grab the legacy screen in one session. --legacy is the
      // post-login screen to navigate to; omit it to capture the landing/dashboard.
      login: loginUrl
        ? {
            loginUrl,
            fields: loginFieldsFromEnv(),
            submitSelector: arg('submit-sel') ?? 'input[type=submit], button[type=submit]',
            successSelector: arg('success-sel'),
            waitMs: arg('wait-ms') ? Number(arg('wait-ms')) : undefined,
            targetUrl: legacy,
          }
        : undefined,
      gate: has('visual-gate') ? 'visual' : 'strict',
      shotsDir: has('no-shots') ? undefined : (arg('shots') ?? '.loom/shots'),
      onLog: (m) => console.error(m),
    });
    console.log('');
    console.log(printReport(result.report));
    console.log(
      result.matched
        ? `\n✓ 1:1 reached in ${result.iterations} iteration(s).`
        : `\n✗ stopped after ${result.iterations} iteration(s) — differences remain (see above).`,
    );
    return result.matched ? 0 : 1;
  } finally {
    atlas.close();
  }
}

const cmd = process.argv[2];
const handler =
  cmd === 'map'
    ? async (): Promise<number> => map()
    : cmd === 'login'
      ? login
      : cmd === 'shot'
        ? shot
        : cmd === 'check'
          ? check
          : cmd === 'run'
            ? run
            : async (): Promise<number> => {
                console.error(
                  `${MAP_USAGE}\n${LOGIN_USAGE}\n${SHOT_USAGE}\n${CHECK_USAGE}\n${RUN_USAGE}`,
                );
                return 2;
              };

handler().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(70);
  },
);
