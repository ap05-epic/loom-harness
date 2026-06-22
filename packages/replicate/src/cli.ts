import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OpenAiDriver } from '@loom/agents';
import { discoverLegacyWebapp, mapProject, openCodeAtlas } from '@loom/cartographer';
import { checkParity } from './check.js';
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

const MAP_USAGE = 'usage: replicate map --struts <struts-config.xml> --out <codeatlas.db>';
const CHECK_USAGE =
  'usage: replicate check --legacy <url> --replica <url> [--atlas <codeatlas.db> --screen <key>] [--storage <auth.json>] [--threshold 1] [--visual-gate] [--llm-diff]';
const RUN_USAGE =
  'usage: replicate run --screen <key> --atlas <codeatlas.db> --legacy <url> --app <reactAppDir> ' +
  '[--webapp <dir>] [--storage <auth.json>] [--build "npx vite build"] [--serve dist] [--route /] ' +
  '[--component src/App.tsx] [--threshold 1] [--max-iterations 12] [--visual-gate] [--model gpt-5.4]';

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
  if (!screen || !atlasPath || !legacy || !app) {
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
      legacyUrl: legacy,
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
      gate: has('visual-gate') ? 'visual' : 'strict',
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
    : cmd === 'check'
      ? check
      : cmd === 'run'
        ? run
        : async (): Promise<number> => {
            console.error(`${MAP_USAGE}\n${CHECK_USAGE}\n${RUN_USAGE}`);
            return 2;
          };

handler().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(70);
  },
);
