import type { SqliteDatabase } from '../db/sqlite-driver.js';
import { SkillStore } from '../skills/skills.js';
import { TaskStore } from '../tasks/tasks.js';
import { GateStore, type GateType } from './gates.js';

export type GateDecision = 'approved' | 'rejected';

export type GateDecisionResult = {
  id: string;
  type: GateType;
  status: GateDecision;
  /** A skill gate was approved → its drafted skill is now active. */
  activated: boolean;
  /** A skill gate was rejected → its drafted skill is now archived. */
  archived: boolean;
  /** A ship gate was approved → its work package is now shipped. */
  shipped: boolean;
};

/**
 * Decide an open gate **and apply its side effect** — the single place every surface (the CLI
 * and Mission Control) routes a human decision through, so approving a gate does the same thing
 * wherever it's clicked. A `skill` gate flips its drafted skill active (approve) or archived
 * (reject); a `ship` gate marks the work package shipped on approval. Returns null when the gate
 * is unknown or already decided.
 */
export function applyGateDecision(
  db: SqliteDatabase,
  id: string,
  decision: GateDecision,
  note?: string,
): GateDecisionResult | null {
  const gates = new GateStore(db);
  const gate = gates.get(id);
  if (!gate || gate.status !== 'open') return null;
  gates.decide(id, decision, note);
  let activated = false;
  let archived = false;
  let shipped = false;
  if (gate.type === 'skill') {
    const skills = new SkillStore(db);
    if (decision === 'approved') {
      skills.setStatus(gate.scopeId, 'active');
      activated = true;
    } else {
      skills.setStatus(gate.scopeId, 'archived');
      archived = true;
    }
  } else if (gate.type === 'ship' && decision === 'approved') {
    new TaskStore(db).setWorkPackageState(gate.scopeId, 'shipped');
    shipped = true;
  }
  return { id, type: gate.type, status: decision, activated, archived, shipped };
}
