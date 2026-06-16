import { applyGateDecision, GateStore, openDb, type GateStatus, type GateType } from '@loom/core';
import { notFoundError } from '../../errors.js';
import { requireExistingDb } from '../../db-path.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';
import type { CliContext } from '../../context.js';

const DB_OPT = { flags: '--db <path>', describe: 'path to loom.db (else --data-dir)' };

type GateRow = { id: string; type: string; scopeId: string; status: string; name: string };

export const gatesListCommand = defineCommand({
  name: 'gates list',
  group: 'work',
  describe: 'List gates awaiting a human decision (plan/deviation/ship/skill)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [
    DB_OPT,
    { flags: '--status <status>', describe: 'filter by status (default: open)' },
    { flags: '--type <type>', describe: 'filter by gate type' },
  ],
  examples: ['loom gates list --data-dir ./.loom-data', 'loom gates list --json'],
  run(ctx, input) {
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const status = (input.options.status as GateStatus | undefined) ?? 'open';
      const type = input.options.type as GateType | undefined;
      const gates: GateRow[] = new GateStore(db).list({ status, type }).map((g) => ({
        id: g.id,
        type: g.type,
        scopeId: g.scopeId,
        status: g.status,
        name: (g.payload as { name?: string }).name ?? '',
      }));
      return { gates };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    const d = data as { gates: GateRow[] };
    if (d.gates.length === 0) {
      ctx.sink.line('no gates');
      return;
    }
    ctx.sink.line(
      renderTable(
        d.gates.map((g) => ({
          id: g.id,
          type: g.type,
          scope: g.scopeId,
          status: g.status,
          name: g.name,
        })),
        [
          { key: 'id', header: 'ID' },
          { key: 'type', header: 'TYPE' },
          { key: 'scope', header: 'SCOPE' },
          { key: 'status', header: 'STATUS' },
          { key: 'name', header: 'NAME' },
        ],
      ),
    );
  },
});

type Decision = 'approved' | 'rejected';
type DecisionResult = {
  id: string;
  type: string;
  status: Decision;
  activated: boolean;
  archived: boolean;
  shipped: boolean;
};

/**
 * Decide an open gate and apply its side effect: a `skill` gate flips its drafted skill active
 * (approve) or archived (reject); a `ship` gate marks the work package shipped on approval.
 */
function decideGate(
  ctx: CliContext,
  dbOpt: unknown,
  id: string,
  decision: Decision,
  note: string | undefined,
): DecisionResult {
  const db = openDb(requireExistingDb(ctx, dbOpt));
  try {
    const result = applyGateDecision(db, id, decision, note);
    if (!result) throw notFoundError('open gate', id, 'see `loom gates list`');
    return result;
  } finally {
    db.close();
  }
}

export const gatesApproveCommand = defineCommand({
  name: 'gates approve',
  group: 'work',
  describe: 'Approve a gate (a skill gate activates the drafted skill so recall can use it)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  args: [{ name: 'id', describe: 'gate id', required: true }],
  options: [DB_OPT, { flags: '--note <text>', describe: 'decision note' }],
  examples: ['loom gates approve gate_abc123 --json'],
  run(ctx, input) {
    return decideGate(
      ctx,
      input.options.db,
      input.args.id as string,
      'approved',
      input.options.note as string | undefined,
    );
  },
  render(data, ctx) {
    const d = data as DecisionResult;
    const effect = d.activated ? ' — skill activated' : d.shipped ? ' — screen shipped' : '';
    ctx.sink.line(`gate ${d.id} approved${effect}`);
  },
});

export const gatesRejectCommand = defineCommand({
  name: 'gates reject',
  group: 'work',
  describe: 'Reject a gate (a skill gate archives the drafted skill)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  args: [{ name: 'id', describe: 'gate id', required: true }],
  options: [DB_OPT, { flags: '--note <text>', describe: 'decision note' }],
  examples: ['loom gates reject gate_abc123 --note "not reusable" --json'],
  run(ctx, input) {
    return decideGate(
      ctx,
      input.options.db,
      input.args.id as string,
      'rejected',
      input.options.note as string | undefined,
    );
  },
  render(data, ctx) {
    const d = data as DecisionResult;
    ctx.sink.line(`gate ${d.id} rejected${d.archived ? ' — skill archived' : ''}`);
  },
});
