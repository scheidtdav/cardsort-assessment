import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DB_PATH, MASTER_TOKEN_ENV } from './config'
import { CARD_SET_VERSION } from './cards'
import { generateAdminKey, generateMasterToken } from './util'
import { DEFAULT_SESSION_KEY } from '@sortiertool/shared/constants'

/**
 * SQLite connection and schema. Importing this module opens the database, creates the tables
 * idempotently, runs pending migrations and seeds the default session.
 */

/** Current schema version; bump on every schema change and add an `if (schemaVersion < N)` step. */
const SCHEMA_VERSION = 3

mkdirSync(dirname(DB_PATH), { recursive: true })

/** The shared synchronous database connection. */
export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = DELETE;')
db.exec('PRAGMA busy_timeout = 5000;')
db.exec('PRAGMA foreign_keys = ON;')

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id               TEXT PRIMARY KEY,
    session_key      TEXT UNIQUE NOT NULL,
    admin_key        TEXT UNIQUE NOT NULL,
    status           TEXT NOT NULL DEFAULT 'open',
    card_set_version TEXT NOT NULL,
    klassenstufe     TEXT NOT NULL,
    schulform        TEXT NOT NULL,
    ml_vorwissen     TEXT NOT NULL,
    bundesland       TEXT,
    note             TEXT,
    requires_student_id INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  -- INVARIANTE: participant_no ist die einzige Kennung, die nach außen darf (nur innerhalb
  -- der Sitzung eindeutig, daher nicht verkettbar). receipt_id ist ein Geheimnis des
  -- abgebenden Clients — niemals in eine Antwort der Admin-/Master-Routen aufnehmen.
  CREATE TABLE IF NOT EXISTS submissions (
    id             TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_no INTEGER NOT NULL,
    receipt_id     TEXT NOT NULL UNIQUE,
    state_json     TEXT NOT NULL,
    student_id     TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE(session_id, participant_no)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

/**
 * Column names of `sessions`; SQLite has no "ADD COLUMN IF NOT EXISTS", so migrations check
 * this list.
 */
const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]

// closed_at NULL = running. Only submissions with created_at <= closed_at are included
// (dashboard/export).
if (!sessionColumns.some((c) => c.name === 'closed_at')) {
  db.exec('ALTER TABLE sessions ADD COLUMN closed_at TEXT;')
}

// --- Versioned migrations -----------------------------------------------------------

/**
 * Reads the stored schema version.
 *
 * DBs without `meta.schema_version` predate versioning; their version is inferred from the
 * table layout.
 *
 * @returns {number} Schema version of the opened database.
 */
function readSchemaVersion(): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
    | { value: string }
    | undefined
  if (row) return Number(row.value)
  const cols = db.prepare('PRAGMA table_info(submissions)').all() as { name: string }[]
  return cols.some((c) => c.name === 'participant_token') ? 1 : SCHEMA_VERSION
}

/**
 * v2 → v3: adds student_id tracking with optional requirement per session.
 *
 * @returns {void}
 */
function migrateToV3(): void {
  db.exec(`
    BEGIN;
    ALTER TABLE sessions ADD COLUMN requires_student_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE submissions ADD COLUMN student_id TEXT;
    COMMIT;
  `)
}

/**
 * v1 → v2: replaces the device token (linkable across sessions) by a per-session sequential
 * `participant_no` in order of first submission, and issues fresh receipts.
 *
 * @returns {void}
 */
function migrateToV2(): void {
  db.exec(`
    BEGIN;
    CREATE TABLE submissions_v2 (
      id             TEXT PRIMARY KEY,
      session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      participant_no INTEGER NOT NULL,
      receipt_id     TEXT NOT NULL UNIQUE,
      state_json     TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE(session_id, participant_no)
    );
    INSERT INTO submissions_v2
      (id, session_id, participant_no, receipt_id, state_json, created_at, updated_at)
    SELECT id, session_id,
           ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, id),
           -- Quittung neu würfeln: die alten Clients kennen sie ohnehin nicht.
           lower(hex(randomblob(16))),
           state_json, created_at, updated_at
    FROM submissions;
    DROP TABLE submissions;
    ALTER TABLE submissions_v2 RENAME TO submissions;
    COMMIT;
  `)
}

/** Schema version of the opened database before migrating. */
const schemaVersion = readSchemaVersion()
if (schemaVersion < 2) migrateToV2()
if (schemaVersion < 3) migrateToV3()

db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
  'schema_version',
  String(SCHEMA_VERSION),
)

/** Timestamp of the default-session seed (ignored if it already exists). */
const seedNow = new Date().toISOString()
db.prepare(
  `INSERT OR IGNORE INTO sessions
     (id, session_key, admin_key, status, card_set_version,
      klassenstufe, schulform, ml_vorwissen, bundesland, note, created_at, updated_at)
   VALUES ('default-session', ?, ?, 'open', ?, 'Standard', 'Standard', '0', NULL,
           'Automatisch angelegte Standard-Sitzung', ?, ?)`,
).run(DEFAULT_SESSION_KEY, generateAdminKey(), CARD_SET_VERSION, seedNow, seedNow)

/**
 * Admin key of the automatically seeded default session.
 *
 * @returns {string} Admin key.
 */
export function getDefaultAdminKey(): string {
  const row = db
    .prepare('SELECT admin_key FROM sessions WHERE session_key = ?')
    .get(DEFAULT_SESSION_KEY) as { admin_key: string }
  return row.admin_key
}

/**
 * Master token for the research access: `MASTER_TOKEN` from the env, otherwise the persisted
 * one, generated and stored on first call.
 *
 * @returns {string} Master token.
 */
export function getMasterToken(): string {
  if (MASTER_TOKEN_ENV) return MASTER_TOKEN_ENV
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('master_token') as
    | { value: string }
    | undefined
  if (row) return row.value
  const token = generateMasterToken()
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('master_token', token)
  return token
}
