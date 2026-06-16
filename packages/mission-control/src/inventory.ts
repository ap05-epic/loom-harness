import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SkillStore, type SqliteDatabase } from '@loom/core';
import { loadSkillDir, type SkillDoc } from '@loom/skills';

export type ToolInfo = { name: string; category: string; description: string };
export type McpInfo = { name: string; description: string };
export type SkillInfo = {
  name: string;
  description: string;
  triggers: string[];
  tier: string;
  status: string;
  project: string | null;
  useCount: number;
  successCount: number;
  /** `db` = tracked in loom.db (counted, gateable); `file` = a SKILL.md on disk only. */
  source: 'db' | 'file';
};
export type DigitItem = { kind: 'skill' | 'agent' | 'mcp'; name: string; description?: string };
export type DigitInventory = {
  home: string;
  skills: DigitItem[];
  agents: DigitItem[];
  mcp: DigitItem[];
};

export type Inventory = {
  tools: ToolInfo[];
  /** External MCP servers attached via the profile (what the harness *consumes*). */
  mcpExternal: McpInfo[];
  skills: SkillInfo[];
  /** What's available in the colleague-shared DIGIT / Copilot home (`~/.copilot`). */
  digit: DigitInventory;
};

export type InventoryOptions = {
  /** Project scope for DB skills (global + this project). */
  project?: string;
  /** The project's SKILL.md library directory. */
  skillsDir?: string;
  /** The DIGIT / Copilot home to scan (default `~/.copilot`). */
  digitHome?: string;
  /** External MCP servers from the profile (`profile.mcp.servers`). */
  externalMcp?: McpInfo[];
};

/**
 * The harness's built-in tool & capability surface — the write path plus the knowledge, verify,
 * and crawl tools, each backed by a real shipped command/capability. Curated (not a runtime
 * registry) so the board describes exactly what the harness can do.
 */
export const HARNESS_TOOLS: ToolInfo[] = [
  {
    name: 'write_file',
    category: 'build',
    description:
      'Builder writes a UTF-8 file into the rebuild output root; paths are confined to the b-repo by the protected-paths hook.',
  },
  {
    name: 'atlas.slice-for-screen',
    category: 'knowledge',
    description: 'The screen slice: action → form bean → view JSPs → forms + taglibs.',
  },
  {
    name: 'atlas.repo-map',
    category: 'knowledge',
    description: 'PageRank whole-app overview naming every screen — a cheap cold-start context.',
  },
  {
    name: 'atlas.find',
    category: 'knowledge',
    description: 'BM25 full-text search over the code graph (FTS5).',
  },
  {
    name: 'atlas.summarize',
    category: 'knowledge',
    description: 'Recover the missing documentation — one grounded LLM summary per screen.',
  },
  {
    name: 'atlas.verify-docs',
    category: 'verify',
    description: 'An adversarial consensus panel checks recovered docs against the source.',
  },
  {
    name: 'parity-eval',
    category: 'verify',
    description: 'The deterministic 7-layer A/B evaluator (visual / DOM / style / coverage).',
  },
  {
    name: 'crawl',
    category: 'crawl',
    description: 'Playwright BFS crawler → UI inventory (form-login, frames, popups).',
  },
];

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Best-effort read of the DIGIT/Copilot MCP config — tolerant: an absent/odd file → none. */
function readDigitMcp(home: string): DigitItem[] {
  for (const file of ['mcp-config.json', 'config.json']) {
    try {
      const raw = JSON.parse(readFileSync(join(home, file), 'utf8')) as Record<string, unknown>;
      const servers = (raw.mcpServers ?? raw.servers) as Record<string, unknown> | undefined;
      if (servers && typeof servers === 'object') {
        return Object.keys(servers).map((name): DigitItem => ({ kind: 'mcp', name }));
      }
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

/** Scan a DIGIT/Copilot home for its skills (`skills/<n>/SKILL.md`), agents, and MCP servers. */
function digitInventory(home: string): DigitInventory {
  const skills = loadSkillDir(join(home, 'skills')).map(
    (d): DigitItem => ({ kind: 'skill', name: d.name, description: d.description }),
  );
  const agents = safeReaddir(join(home, 'agents'))
    .filter((f) => f.endsWith('.agent.md'))
    .sort()
    .map((f): DigitItem => ({ kind: 'agent', name: f.replace(/\.agent\.md$/, '') }));
  return { home, skills, agents, mcp: readDigitMcp(home) };
}

/**
 * Assemble the full inventory the board shows: the harness's built-in tools, the external MCP
 * servers it consumes, every skill it knows (tracked DB skills + on-disk SKILL.md files, file
 * skills whose name a DB skill already covers are dropped), and what's available in the shared
 * DIGIT/Copilot home. Read-only.
 */
export function inventory(db: SqliteDatabase, opts: InventoryOptions = {}): Inventory {
  const dbSkills = new SkillStore(db).list(
    opts.project !== undefined ? { project: opts.project } : {},
  );
  const dbNames = new Set(dbSkills.map((s) => s.name));
  const onDisk: SkillDoc[] = opts.skillsDir ? loadSkillDir(opts.skillsDir) : [];
  const fileSkills = onDisk.filter((d) => !dbNames.has(d.name));
  const skills: SkillInfo[] = [
    ...dbSkills.map(
      (s): SkillInfo => ({
        name: s.name,
        description: s.description,
        triggers: s.triggers,
        tier: s.tier,
        status: s.status,
        project: s.project,
        useCount: s.useCount,
        successCount: s.successCount,
        source: 'db',
      }),
    ),
    ...fileSkills.map(
      (d): SkillInfo => ({
        name: d.name,
        description: d.description,
        triggers: d.triggers,
        tier: 'project',
        status: 'file',
        project: null,
        useCount: 0,
        successCount: 0,
        source: 'file',
      }),
    ),
  ];
  return {
    tools: HARNESS_TOOLS,
    mcpExternal: opts.externalMcp ?? [],
    skills,
    digit: digitInventory(opts.digitHome ?? join(homedir(), '.copilot')),
  };
}
