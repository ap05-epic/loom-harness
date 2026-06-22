// Proof of the pipeline minus the model: serve a legacy screen + the *built React* replica, then run
// the deterministic checker (visual + DOM + style + forms) against them. No LLM. Run after
// `vite build` in this dir. Exit 0 = the checker confirms 1:1.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkParity, diffsForLlm, printReport, serveStatic } from '@loom/replicate';

const here = dirname(fileURLToPath(import.meta.url));
const legacyHtml = readFileSync(join(here, 'legacy.html'), 'utf8');

const legacy = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(legacyHtml);
});
await new Promise((r) => legacy.listen(0, '127.0.0.1', r));
const legacyUrl = `http://127.0.0.1:${legacy.address().port}/login`;

const replica = await serveStatic(join(here, 'dist'));

console.log(`legacy screen : ${legacyUrl}`);
console.log(`React replica : ${replica.url}/  (the built Vite/React app in ./dist)`);
console.log('running the deterministic checker (no model)…\n');

const report = await checkParity({ legacyUrl, replicaUrl: `${replica.url}/`, threshold: 1 });
console.log(printReport(report));
if (!report.matched) {
  console.log('\n--- differences the machine found ---');
  console.log(diffsForLlm(report));
}

await replica.stop();
legacy.close();
process.exit(report.matched ? 0 : 1);
