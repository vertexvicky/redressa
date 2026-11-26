import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../config/logger';

export interface DbStatement {
  run: (...params: unknown[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (...params: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all: (...params: unknown[]) => any[];
}

export interface DbWrapper {
  prepare: (sql: string) => DbStatement;
  exec: (sql: string) => void;
  pragma: (_pragma: string) => void;
  close: () => void;
}

let rawDb: SqlJsDatabase | null = null;
let wrapper: DbWrapper | null = null;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  payload TEXT NOT NULL,
  call_id TEXT,
  failure_reason TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_request_id ON events(request_id);
CREATE INDEX IF NOT EXISTS idx_events_idempotency_key ON events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  masked_phone TEXT NOT NULL,
  provider_call_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  duration INTEGER,
  outcome TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calls_event_id ON calls(event_id);
CREATE INDEX IF NOT EXISTS idx_calls_request_id ON calls(request_id);
CREATE INDEX IF NOT EXISTS idx_calls_provider_call_id ON calls(provider_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
`;

function persistDb(): void {
  if (!rawDb) return;
  const dbPath = config.databasePath;
  if (!dbPath || dbPath === ':memory:') return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = rawDb.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function createWrapper(sqlDb: SqlJsDatabase): DbWrapper {
  return {
    prepare(sql: string): DbStatement {
      return {
        run(...params: unknown[]) {
          sqlDb.run(sql, params as initSqlJs.BindParams);
          persistDb();
        },
        get(...params: unknown[]) {
          const stmt = sqlDb.prepare(sql);
          try {
            stmt.bind(params as initSqlJs.BindParams);
            if (stmt.step()) {
              return stmt.getAsObject() as Record<string, unknown>;
            }
            return undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]) {
          const stmt = sqlDb.prepare(sql);
          const rows: Record<string, unknown>[] = [];
          try {
            stmt.bind(params as initSqlJs.BindParams);
            while (stmt.step()) {
              rows.push(stmt.getAsObject() as Record<string, unknown>);
            }
            return rows;
          } finally {
            stmt.free();
          }
        },
      };
    },
    exec(sql: string) {
      sqlDb.exec(sql);
      persistDb();
    },
    pragma(_pragma: string) {
      // No-op in sql.js
    },
    close() {
      persistDb();
      sqlDb.close();
    },
  };
}

export async function initDb(): Promise<DbWrapper> {
  if (wrapper) return wrapper;

  const SQL = await initSqlJs();
  const dbPath = config.databasePath;

  if (dbPath && dbPath !== ':memory:' && fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  wrapper = createWrapper(rawDb);
  wrapper.exec(MIGRATIONS);
  logger.info({ path: dbPath }, 'Database initialised (sql.js)');
  return wrapper;
}

export function getDb(): DbWrapper {
  if (!wrapper) {
    throw new Error('Database not initialised. Call await initDb() before using getDb().');
  }
  return wrapper;
}

export function closeDb(): void {
  if (wrapper) {
    wrapper.close();
    wrapper = null;
    rawDb = null;
    logger.info('Database closed');
  }
}

/** For tests: reset the singleton so a fresh DB can be created */
export function resetDb(): void {
  if (rawDb) {
    try {
      rawDb.close();
    } catch {
      // ignore
    }
  }
  wrapper = null;
  rawDb = null;
}
