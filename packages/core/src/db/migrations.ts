import type { Migration } from './db.js';

/**
 * Forward-only migrations for harness.db. Never edit a released migration —
 * add a new version. (Pre-v0.1.0 the schema is still allowed to evolve in place.)
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'events',
    sql: `
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        run_id TEXT,
        wp_id TEXT,
        attempt_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_events_run ON events(run_id, id);
      CREATE INDEX idx_events_wp ON events(wp_id, id);
    `,
  },
  {
    version: 2,
    name: 'task_graph',
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        stage TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finished_at TEXT,
        harness_version TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE work_packages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'screen',
        screen_key TEXT,
        title TEXT NOT NULL,
        spec_json TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE wp_deps (
        wp_id TEXT NOT NULL,
        depends_on TEXT NOT NULL,
        PRIMARY KEY (wp_id, depends_on)
      );
      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        wp_id TEXT NOT NULL,
        n INTEGER NOT NULL,
        role TEXT NOT NULL,
        driver TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        pid INTEGER,
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finished_at TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        state_hash_after TEXT,
        branch TEXT,
        transcript_artifact TEXT,
        failure_reason TEXT
      );
      CREATE TABLE eval_scores (
        id TEXT PRIMARY KEY,
        wp_id TEXT NOT NULL,
        attempt_id TEXT,
        scorecard_json TEXT NOT NULL DEFAULT '{}',
        visual_pct REAL,
        passed INTEGER NOT NULL DEFAULT 0,
        is_best INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE gates (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        payload_json TEXT NOT NULL DEFAULT '{}',
        requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        decided_at TEXT,
        note TEXT
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_wp_run ON work_packages(run_id, state);
      CREATE INDEX idx_attempts_wp ON attempts(wp_id, n);
      CREATE INDEX idx_eval_wp ON eval_scores(wp_id);
      CREATE INDEX idx_gates_scope ON gates(scope_type, scope_id, status);
      CREATE INDEX idx_artifacts_scope ON artifacts(scope_type, scope_id);
    `,
  },
  {
    version: 3,
    name: 'memory',
    sql: `
      CREATE TABLE memory_index (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope_id TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_memory_project ON memory_index(project, kind);
      CREATE INDEX idx_memory_scope ON memory_index(scope_id);
    `,
  },
  {
    version: 4,
    name: 'skills',
    sql: `
      CREATE TABLE skills_index (
        id TEXT PRIMARY KEY,
        project TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        triggers_json TEXT NOT NULL DEFAULT '[]',
        body TEXT NOT NULL DEFAULT '',
        tier TEXT NOT NULL DEFAULT 'generated',
        status TEXT NOT NULL DEFAULT 'draft',
        use_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_skills_scope ON skills_index(project, status);
      CREATE INDEX idx_skills_name ON skills_index(name);
    `,
  },
  {
    version: 5,
    name: 'agent_questions',
    sql: `
      CREATE TABLE agent_questions (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        wp_id TEXT,
        question TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open',
        answer TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        answered_at TEXT
      );
      CREATE INDEX idx_questions_status ON agent_questions(status, wp_id);
    `,
  },
  {
    version: 6,
    name: 'spans',
    sql: `
      CREATE TABLE spans (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unset',
        run_id TEXT,
        wp_id TEXT,
        attempt_id TEXT,
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ended_at TEXT,
        duration_ms INTEGER,
        attributes_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_spans_trace ON spans(trace_id, started_at);
      CREATE INDEX idx_spans_run ON spans(run_id, started_at);
    `,
  },
  {
    version: 7,
    name: 'chat',
    sql: `
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls_json TEXT,
        tool_call_id TEXT,
        ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, seq);
      CREATE INDEX idx_chat_sessions_project ON chat_sessions(project, updated_at);
    `,
  },
];
