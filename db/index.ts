import { createClient, type Client, type InStatement, type InValue, type ResultSet } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// The study was first hosted on Cloudflare D1. Its routes are written against D1's
// prepare/bind/first/all/run/batch surface, so this adapter keeps that surface and runs it on
// libSQL (Turso in production, a local SQLite file in development). The SQL is unchanged.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number; last_row_id: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  readonly statement: InStatement;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

let client: Client | undefined;
let schemaReadiness: Promise<void> | undefined;

// Env values pasted into a hosting dashboard often carry stray whitespace or the quotes from
// .env.example; either makes libSQL reject the URL or token.
function cleanEnv(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  return cleaned || undefined;
}

function getClient(): Client {
  if (client) return client;
  const url = cleanEnv(process.env.TURSO_DATABASE_URL);
  const hosted = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  // A local SQLite file is only for development; hosted functions have a read-only disk, so
  // falling back there would fail later with an obscure SQLITE_CANTOPEN.
  if (!url && hosted) throw new Error("TURSO_DATABASE_URL is not set in the hosting environment.");
  client = createClient({ url: url ?? "file:local.db", authToken: cleanEnv(process.env.TURSO_AUTH_TOKEN) });
  return client;
}

function toResult<T>(set: ResultSet): D1Result<T> {
  const results = set.rows.map((row) => Object.fromEntries(set.columns.map((column, index) => [column, row[index]])) as T);
  return { results, meta: { changes: set.rowsAffected, last_row_id: Number(set.lastInsertRowid ?? 0) } };
}

function prepareStatement(db: Client, sql: string, args: InValue[] = []): D1PreparedStatement {
  const statement: InStatement = { sql, args };
  return {
    statement,
    bind: (...values) => prepareStatement(db, sql, values.map((value) => (value === undefined ? null : (value as InValue)))),
    first: async <T>() => toResult<T>(await db.execute(statement)).results[0] ?? null,
    all: async <T>() => toResult<T>(await db.execute(statement)),
    run: async <T>() => toResult<T>(await db.execute(statement)),
  };
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export function getD1(): D1Database {
  const db = getClient();
  return {
    prepare: (sql) => prepareStatement(db, sql),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      if (statements.length === 0) return [];
      const sets = await db.batch(statements.map((statement) => statement.statement), "write");
      return sets.map((set) => toResult<T>(set));
    },
  };
}

export async function ensureStudySchema(): Promise<void> {
  if (!schemaReadiness) {
    schemaReadiness = initializeSchema().catch((error: unknown) => {
      schemaReadiness = undefined;
      throw error;
    });
  }
  return schemaReadiness;
}

async function initializeSchema(): Promise<void> {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      sequence TEXT NOT NULL,
      study_phase TEXT DEFAULT 'development' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      current_position INTEGER DEFAULT 0 NOT NULL,
      vtt_tools TEXT DEFAULT '[]' NOT NULL,
      vtt_other TEXT,
      vtt_comfort INTEGER DEFAULT 0 NOT NULL,
      dice_familiarity TEXT DEFAULT 'not_collected' NOT NULL,
      vtt_experience TEXT NOT NULL,
      notation_familiarity TEXT NOT NULL,
      device_class TEXT NOT NULL,
      input_method TEXT NOT NULL,
      consented_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS study_sessions_balance_idx ON study_sessions (study_phase, status, sequence)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS study_trials (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      interface_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      task_pack INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      is_practice INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'presented' NOT NULL,
      presented_at INTEGER NOT NULL,
      first_interaction_at INTEGER,
      valid_roll_at INTEGER,
      animation_completed_at INTEGER,
      elapsed_ms INTEGER,
      invalid_attempts INTEGER DEFAULT 0 NOT NULL,
      help_opened INTEGER DEFAULT 0 NOT NULL,
      ease_rating INTEGER,
      confidence_rating INTEGER,
      comment TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS study_trials_session_task_idx ON study_trials (session_id, interface_id, task_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS study_trials_session_idx ON study_trials (session_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS study_events (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      trial_id TEXT,
      event_type TEXT NOT NULL,
      interface_id TEXT,
      position INTEGER,
      task_pack INTEGER,
      task_id TEXT,
      occurred_at INTEGER NOT NULL,
      payload TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS study_events_session_time_idx ON study_events (session_id, occurred_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS study_events_trial_time_idx ON study_events (trial_id, occurred_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS study_contact_opt_ins (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      email TEXT NOT NULL,
      session_id TEXT,
      study_phase TEXT NOT NULL,
      consented_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS study_contact_opt_ins_kind_idx ON study_contact_opt_ins (kind)"),
    db.prepare("CREATE INDEX IF NOT EXISTS study_contact_opt_ins_session_idx ON study_contact_opt_ins (session_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS study_admin_state (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      is_live INTEGER DEFAULT 0 NOT NULL,
      launched_at INTEGER
    )`),
    db.prepare("INSERT OR IGNORE INTO study_admin_state (id, is_live) VALUES (1, 0)"),
  ]);

  const sessionColumns = await db.prepare("PRAGMA table_info(study_sessions)").all<{ name: string }>();
  const existingColumns = new Set((sessionColumns.results ?? []).map((column) => column.name));
  const additions: D1PreparedStatement[] = [];
  if (!existingColumns.has("vtt_tools")) additions.push(db.prepare("ALTER TABLE study_sessions ADD COLUMN vtt_tools TEXT DEFAULT '[]' NOT NULL"));
  if (!existingColumns.has("vtt_other")) additions.push(db.prepare("ALTER TABLE study_sessions ADD COLUMN vtt_other TEXT"));
  if (!existingColumns.has("vtt_comfort")) additions.push(db.prepare("ALTER TABLE study_sessions ADD COLUMN vtt_comfort INTEGER DEFAULT 0 NOT NULL"));
  if (!existingColumns.has("dice_familiarity")) additions.push(db.prepare("ALTER TABLE study_sessions ADD COLUMN dice_familiarity TEXT DEFAULT 'not_collected' NOT NULL"));
  if (additions.length > 0) await db.batch(additions);
  await db.prepare("PRAGMA optimize").run();
}
