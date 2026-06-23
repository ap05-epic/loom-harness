import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OpenAiDriver } from '@loom/agents';
import { captureDom, captureScreenshot, DEFAULT_VIEWPORT, type DomSnapshot } from '@loom/browser';
import { discoverLegacyWebapp, mapProject, openCodeAtlas } from '@loom/cartographer';
import { checkParity } from './check.js';
import { runCrawl } from './crawl.js';
import { openCrawlDb } from './crawl-db.js';
import { buildNavTree, navTreeToDot, printNavTree } from './graph.js';
import { doLogin, loginAndCapture, looksLikeFailure, type LoginField } from './login.js';
import { extractNavigation } from './nav.js';
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
const GRAPH_USAGE =
  'usage: replicate graph --atlas <codeatlas.db> [--json <out.json>] [--dot <out.dot>]  (prints the nav tree by default)';
const LOGIN_USAGE =
  'usage: replicate login --legacy <loginUrl> [--out .loom/auth.json] [--user-sel <css>] [--pass-sel <css>] ' +
  '[--fa-sel <css>] [--submit-sel <css>] [--success-sel <css>]  (creds from env: BAA_USER, BAA_PASS, BAA_FA)';
const SHOT_USAGE =
  'usage: replicate shot --legacy <url> [--login <loginUrl> (live login, creds from env) | --storage <auth.json>] [--out .loom/shots/probe.png]';
const NAV_USAGE =
  'usage: replicate nav --login <loginUrl> [--legacy <post-login screen>] [--out .loom/nav.json]  (creds from env: BAA_USER, BAA_PASS)';
const CRAWL_USAGE =
  'usage: replicate crawl --login <loginUrl> [--start <path>] [--db .loom/crawl.db] [--bodies <dir>] [--shots <dir>] ' +
  '[--fa-hint <regex>] [--follow-js] [--max-states N] [--max-actions N] [--max-depth N] [--load-ms 15000] [--deny <regex>] [--print]  (creds + BAA_FA from env)';
const CHECK_USAGE =
  'usage: replicate check --legacy <url> --replica <url> [--atlas <codeatlas.db> --screen <key>] [--storage <auth.json>] [--threshold 1] [--visual-gate] [--llm-diff]';
const RUN_USAGE =
  'usage: replicate run --screen <key> --atlas <codeatlas.db> --app <reactAppDir> ' +
  '(--legacy <url> | --login <loginUrl> [--legacy <post-login target>]) ' +
  '[--webapp <dir>] [--reuse-assets] [--crawl-db .loom/crawl.db] [--fa-hint <regex>] [--load-ms 15000] [--screens .loom/screens | --no-screens] ' +
  '[--build "npx vite build"] [--serve dist] [--route /] ' +
  '[--component src/App.tsx] [--threshold 1] [--max-iterations 12] [--visual-gate] [--shots .loom/shots | --no-shots] [--model gpt-5.4]  (FA from env BAA_FA)';

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

/**
 * `replicate graph` — print (or export JSON/DOT) the navigation tree from the static map: every screen
 * → the screens it links/submits/forwards to. This IS the "tree of all user paths," already complete in
 * the atlas from struts-config — no crawling. No model.
 */
function graph(): number {
  const atlasPath = arg('atlas');
  if (!atlasPath) {
    console.error(GRAPH_USAGE);
    return 2;
  }
  const atlas = openCodeAtlas(atlasPath);
  try {
    const tree = buildNavTree(atlas);
    const json = arg('json');
    const dot = arg('dot');
    if (json) {
      mkdirSync(dirname(json), { recursive: true });
      writeFileSync(json, JSON.stringify(tree, null, 2));
      console.log(`✓ ${tree.screenCount} screen(s) · ${tree.edgeCount} edge(s) → ${json}`);
    }
    if (dot) {
      mkdirSync(dirname(dot), { recursive: true });
      writeFileSync(dot, navTreeToDot(tree));
      console.log(`✓ DOT → ${dot}`);
    }
    if (!json && !dot) console.log(printNavTree(tree));
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
 * `replicate nav` — log in, go to a screen, and map every link/form to where it leads (the runtime
 * click→destination map). Classifies real navigations (verifiable 1:1) vs JS‑driven actions
 * (overlays — behavior we'd have to rebuild). Saves to `--out` + prints a readable summary. No LLM.
 */
async function nav(): Promise<number> {
  const loginUrl = arg('login');
  if (!loginUrl) {
    console.error(NAV_USAGE);
    return 2;
  }
  const fields = loginFieldsFromEnv();
  if (fields.length === 0) {
    console.error('set BAA_USER and BAA_PASS in the environment.');
    return 2;
  }
  const out = arg('out') ?? '.loom/nav.json';
  mkdirSync(dirname(out), { recursive: true });
  const { dom, finalUrl } = await loginAndCapture({
    loginUrl,
    targetUrl: arg('legacy'),
    fields,
    submitSelector: arg('submit-sel') ?? 'input[type=submit], button[type=submit]',
    successSelector: arg('success-sel'),
    waitMs: arg('wait-ms') ? Number(arg('wait-ms')) : undefined,
    onLog: (m) => console.error(m),
  });
  const links = extractNavigation(dom);
  writeFileSync(out, JSON.stringify({ url: finalUrl, links }, null, 2));
  const real = links.filter((l) => l.kind === 'navigation');
  const forms = links.filter((l) => l.kind === 'form-submit');
  const js = links.filter((l) => l.kind === 'js-action');
  const anchors = links.length - real.length - forms.length - js.length;
  console.log(`\n✓ mapped ${links.length} navigable element(s) on ${finalUrl} → ${out}`);
  console.log(
    `  ${real.length} real link(s) · ${forms.length} form(s) · ${js.length} JS-driven · ${anchors} anchor(s)\n`,
  );
  for (const l of real.slice(0, 40)) console.log(`  🔗 ${l.label}  →  ${l.target}`);
  for (const l of forms.slice(0, 10)) console.log(`  📝 ${l.label}  →  ${l.target}`);
  if (js.length > 0) {
    console.log(
      `\n  ⚡ ${js.length} JS-driven action(s) (overlays etc.) — not simple links; e.g.:`,
    );
    for (const l of js.slice(0, 5)) console.log(`     ${l.label}  →  ${l.target.slice(0, 70)}`);
  }
  return 0;
}

/**
 * `replicate crawl` — exhaustively click every link/tab/button across the live app (both FA states),
 * mapping all user paths + each screen's data endpoints/payloads + value→endpoint provenance into
 * `.loom/crawl.db`. Deterministic, no LLM, resumable. `--print` dumps the map without crawling.
 */
async function crawl(): Promise<number> {
  const loginUrl = arg('login');
  if (!loginUrl && !has('print')) {
    console.error(CRAWL_USAGE);
    return 2;
  }
  const dbPath = arg('db') ?? '.loom/crawl.db';
  const bodiesDir = arg('bodies') ?? '.loom/crawl-bodies';
  const shotsDir = arg('shots') ?? '.loom/crawl-shots';
  const faValue = process.env.BAA_FA;
  const secrets = [faValue, process.env.BAA_PASS].filter((x): x is string => Boolean(x));
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = openCrawlDb(dbPath, { bodiesDir, secrets });

  // --print: read the mapped graph without crawling.
  if (has('print')) {
    const g = store.graph();
    console.log(`crawl graph — ${g.states.length} state(s), ${g.edges.length} edge(s)`);
    for (const s of g.states) {
      console.log(`\n${s.key} [${s.state_tag}]  ${s.url}`);
      for (const e of store.interactionsFor(s.id)) {
        const to = e.to_state_id
          ? (g.states.find((x) => x.id === e.to_state_id)?.key ?? '?')
          : e.followed
            ? 'dead'
            : 'record-only';
        console.log(
          `   ${e.action_kind} "${e.label ?? ''}" → ${to}${e.is_destructive ? ' (destructive)' : ''}`,
        );
      }
      const eps = store.endpointsFor(s.id);
      if (eps.length > 0)
        console.log(`   🔌 ${eps.map((x) => `${x.method} ${x.url}`).join(' · ')}`);
    }
    store.close();
    return 0;
  }

  if (!loginUrl) {
    console.error(CRAWL_USAGE);
    store.close();
    return 2;
  }
  const fields = loginFieldsFromEnv();
  if (fields.length === 0) {
    console.error('set BAA_USER and BAA_PASS in the environment.');
    store.close();
    return 2;
  }
  try {
    const summary = await runCrawl({
      login: {
        loginUrl,
        fields,
        submitSelector: arg('submit-sel') ?? 'input[type=submit], button[type=submit]',
        successSelector: arg('success-sel'),
        waitMs: arg('wait-ms') ? Number(arg('wait-ms')) : undefined,
      },
      startPath: arg('start'),
      fa: faValue
        ? {
            value: faValue,
            hint: arg('fa-hint') ? new RegExp(arg('fa-hint')!, 'i') : undefined,
            submitSelector: arg('fa-submit-sel'),
          }
        : undefined,
      followJs: has('follow-js'),
      deny: arg('deny') ? new RegExp(arg('deny')!, 'i') : undefined,
      loadMs: arg('load-ms') ? Number(arg('load-ms')) : undefined,
      maxStates: arg('max-states') ? Number(arg('max-states')) : undefined,
      maxActions: arg('max-actions') ? Number(arg('max-actions')) : undefined,
      maxDepth: arg('max-depth') ? Number(arg('max-depth')) : undefined,
      store,
      shotsDir,
      secrets,
      onLog: (m) => console.error(m),
    });
    console.log(
      `\n✓ crawled ${summary.states} screen(s) · ${summary.interactions} action(s) · ` +
        `${summary.endpoints} endpoint(s) · ${summary.provenance} value(s) → ${dbPath}` +
        (summary.truncated ? ' (hit a budget cap — resumable, run again)' : ''),
    );
    return 0;
  } finally {
    store.close();
  }
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
      webappDir: webapp,
      reuseAssets: has('reuse-assets'),
      crawlDbPath: arg('crawl-db'),
      crawlBodiesDir: arg('crawl-bodies'),
      threshold: arg('threshold') ? Number(arg('threshold')) : 1,
      maxIterations: arg('max-iterations') ? Number(arg('max-iterations')) : 12,
      storageStatePath: arg('storage'),
      // The FA gateway (BAA): BAA_FA from env → the FA-selected (data-filled) state. --fa-hint tunes
      // how the FA box is found. Never a flag — the FA stays in env, redacted in artifacts.
      fa: process.env.BAA_FA
        ? {
            value: process.env.BAA_FA,
            hint: arg('fa-hint') ? new RegExp(arg('fa-hint')!, 'i') : undefined,
            submitSelector: arg('fa-submit-sel'),
          }
        : undefined,
      loadMs: arg('load-ms') ? Number(arg('load-ms')) : undefined,
      screensDir: has('no-screens') ? undefined : (arg('screens') ?? '.loom/screens'),
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
    : cmd === 'graph'
      ? async (): Promise<number> => graph()
      : cmd === 'login'
        ? login
        : cmd === 'shot'
          ? shot
          : cmd === 'nav'
            ? nav
            : cmd === 'crawl'
              ? crawl
              : cmd === 'check'
                ? check
                : cmd === 'run'
                  ? run
                  : async (): Promise<number> => {
                      console.error(
                        `${MAP_USAGE}\n${GRAPH_USAGE}\n${LOGIN_USAGE}\n${SHOT_USAGE}\n${NAV_USAGE}\n${CRAWL_USAGE}\n${CHECK_USAGE}\n${RUN_USAGE}`,
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
