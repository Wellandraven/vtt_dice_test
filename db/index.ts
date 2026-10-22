import { getDatabase } from "@netlify/database";
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";

// The study was first hosted on Cloudflare D1. Its routes are written against D1's
// prepare/bind/first/all/run/batch surface, so this adapter keeps that surface and runs it on
// Netlify Database (Postgres). Statements keep D1's `?` placeholders; they are numbered here.
// The schema itself is created by the migrations in netlify/database/migrations.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

interface Statement {
  text: string;
  values: unknown[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  readonly statement: Statement;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
  fields: { name: string; dataTypeID: number }[];
}

interface Queryable {
  query(text: string, values: unknown[]): Promise<QueryResult>;
}

// Postgres returns bigint (COUNT, timestamps) and numeric (SUM, AVG) as strings; the routes
// expect numbers as SQLite returned them. Millisecond timestamps fit safely in a JS number.
const NUMERIC_TYPE_IDS = new Set([20, 1700]);

function pool(): Queryable & { connect(): Promise<Queryable & { release(): void }> } {
  return getDatabase().pool as unknown as Queryable & { connect(): Promise<Queryable & { release(): void }> };
}

function numberPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function toResult<T>(result: QueryResult): D1Result<T> {
  const numeric = result.fields.filter((field) => NUMERIC_TYPE_IDS.has(field.dataTypeID)).map((field) => field.name);
  const results = result.rows.map((row) => {
    for (const name of numeric) if (row[name] !== null && row[name] !== undefined) row[name] = Number(row[name]);
    return row as T;
  });
  return { results, meta: { changes: result.rowCount ?? 0 } };
}

function prepareStatement(sql: string, values: unknown[] = []): D1PreparedStatement {
  const statement: Statement = { text: numberPlaceholders(sql), values };
  const execute = async <T>() => toResult<T>(await pool().query(statement.text, statement.values));
  return {
    statement,
    bind: (...next) => prepareStatement(sql, next.map((value) => (value === undefined ? null : value))),
    first: async <T>() => (await execute<T>()).results[0] ?? null,
    all: execute,
    run: execute,
  };
}

export function getDb() {
  return drizzle({ schema });
}

export function getD1(): D1Database {
  return {
    prepare: (sql) => prepareStatement(sql),
    // D1 runs a batch atomically, so the statements share one transaction.
    batch: async <T>(statements: D1PreparedStatement[]) => {
      if (statements.length === 0) return [];
      const client = await pool().connect();
      try {
        await client.query("BEGIN", []);
        const results: D1Result<T>[] = [];
        for (const { statement } of statements) results.push(toResult<T>(await client.query(statement.text, statement.values)));
        await client.query("COMMIT", []);
        return results;
      } catch (error) {
        await client.query("ROLLBACK", []).catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

// Tables are created by migrations at deploy time; this remains so route call sites are unchanged.
export async function ensureStudySchema(): Promise<void> {}
