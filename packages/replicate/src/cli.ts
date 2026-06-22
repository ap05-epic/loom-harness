import { openCodeAtlas } from '@loom/cartographer';
import { checkParity } from './check.js';
import { diffsForLlm, printReport } from './report.js';

/** Read `--name value`. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
/** Read a boolean `--flag`. */
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const USAGE =
  'usage: replicate check --legacy <url> --replica <url> [--atlas <codeatlas.db> --screen <key>] [--threshold 1] [--llm-diff]';

/**
 * `replicate check` — deterministically compare a built React replica against the live legacy screen
 * (visual + DOM + style + forms + path/route) and print the exact differences. No LLM. Exit 0 when
 * 1:1, 1 when differences remain, 2 on a usage error.
 */
async function check(): Promise<number> {
  const legacy = arg('legacy');
  const replica = arg('replica');
  if (!legacy || !replica) {
    console.error(USAGE);
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

const cmd = process.argv[2];
const run =
  cmd === 'check'
    ? check
    : async (): Promise<number> => {
        console.error(USAGE);
        return 2;
      };

run().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(70);
  },
);
