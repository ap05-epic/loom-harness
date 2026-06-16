import { spawnSync } from 'node:child_process';
import { openDb } from '@loom/core';
import { defineCommand } from '../../registry.js';

type StatusData = {
  version: string;
  checkout: string;
  node: string;
  sqliteBackend: string;
};

function gitDescribe(cwd: string): string {
  const res = spawnSync('git', ['describe', '--tags', '--always'], {
    cwd,
    encoding: 'utf8',
    shell: true,
  });
  return res.status === 0 ? res.stdout.trim() : '(not a git checkout)';
}

export const statusCommand = defineCommand({
  name: 'status',
  group: 'lifecycle',
  describe: 'Show Loom version, checkout, and environment',
  examples: ['loom status', 'loom status --json'],
  run(ctx) {
    const db = openDb(':memory:');
    const backend = db.backend;
    db.close();
    return {
      version: ctx.version,
      checkout: gitDescribe(ctx.cwd),
      node: process.versions.node,
      sqliteBackend: backend,
    } satisfies StatusData;
  },
  render(data, ctx) {
    const d = data as StatusData;
    ctx.sink.line(`loom ${d.version}`);
    ctx.sink.line(`checkout: ${d.checkout}`);
    ctx.sink.line(`node:     ${d.node}`);
    ctx.sink.line(`sqlite:   ${d.sqliteBackend}`);
  },
});
