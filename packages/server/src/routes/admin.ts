import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { db } from '../db'
import { aggregateCsvFromStates, analysisFromRows } from '../results'
import type { SubmissionRow } from '../results'
import { CARD_SET_VERSION, cards, isCardSetOutdated, schemas } from '../cards'
import { groupsJson, metricsCsv, namesCsv } from '../exports'
import { withMeta } from '../csv'

/**
 * Session row as read from the `sessions` table.
 *
 * @property {string} id Internal session id.
 * @property {string} session_key Session key learners join with.
 * @property {string} admin_key Admin key (secret).
 * @property {string} status `open` or `closed`.
 * @property {string | null} closed_at ISO timestamp of closing, `null` while running.
 * @property {string} card_set_version Card-set version at creation.
 * @property {string} klassenstufe Grade level.
 * @property {string} schulform School type.
 * @property {string} ml_vorwissen Prior ML knowledge.
 * @property {string | null} bundesland Federal state.
 * @property {string | null} note Teacher's note.
 * @property {number} requires_student_id Whether student ID is required for submissions.
 * @property {string} created_at ISO creation timestamp.
 * @property {string} updated_at ISO timestamp of the last change.
 */
interface SessionRow {
  id: string
  session_key: string
  admin_key: string
  status: string
  closed_at: string | null
  card_set_version: string
  klassenstufe: string
  schulform: string
  ml_vorwissen: string
  bundesland: string | null
  note: string | null
  requires_student_id: number
  created_at: string
  updated_at: string
}

/**
 * Looks up a session by its admin key, case-insensitively.
 *
 * @param {string} adminKey Admin key from the URL.
 * @returns {SessionRow | undefined} The session, or `undefined` if unknown.
 */
function findSessionByAdminKey(adminKey: string): SessionRow | undefined {
  return db
    .prepare(
      `SELECT id, session_key, admin_key, status, closed_at, card_set_version, klassenstufe,
              schulform, ml_vorwissen, bundesland, note, requires_student_id, created_at, updated_at
       FROM sessions WHERE admin_key = ? COLLATE NOCASE`,
    )
    .get(adminKey) as SessionRow | undefined
}

/**
 * Session as returned to the client, WITHOUT `admin_key` — this shape also ends up in the
 * shareable JSON export.
 *
 * @param {SessionRow} s Session row.
 * @returns {object} Camel-cased public session fields incl. `cardSetOutdated`.
 */
function publicSession(s: SessionRow) {
  return {
    sessionKey: s.session_key,
    status: s.status,
    closedAt: s.closed_at,
    cardSetVersion: s.card_set_version,
    cardSetOutdated: isCardSetOutdated(s.card_set_version),
    klassenstufe: s.klassenstufe,
    schulform: s.schulform,
    mlVorwissen: s.ml_vorwissen,
    bundesland: s.bundesland,
    note: s.note,
    requiresStudentId: s.requires_student_id === 1,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }
}

/** SQL inclusion rule (submitted before closing); expects `closed_at` twice as parameter. */
const INCLUDED = '(? IS NULL OR created_at <= ?)'

/**
 * Included submissions of a session, ordered by participant number.
 *
 * @param {SessionRow} s Session row.
 * @returns {SubmissionRow[]} Included submissions.
 */
function includedRows(s: SessionRow): SubmissionRow[] {
  return db
    .prepare(
      `SELECT participant_no, state_json, student_id, created_at, updated_at FROM submissions
       WHERE session_id = ? AND ${INCLUDED} ORDER BY participant_no`,
    )
    .all(s.id, s.closed_at, s.closed_at) as unknown as SubmissionRow[]
}

/**
 * Teacher's session management, authorized by the admin key in the path. Every route answers
 * `404 not_found` for an unknown key.
 *
 * @param {FastifyInstance} app Fastify instance.
 * @returns {Promise<void>}
 */
export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/admin/:adminKey — session overview with included submissions.
   *
   * @returns {object} `{ session (incl. adminKey), submissionCount, excludedCount, submissions }`.
   */
  app.get<{ Params: { adminKey: string } }>(
    '/api/admin/:adminKey',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      const subs = db
        .prepare(
          `SELECT participant_no, created_at, updated_at FROM submissions
           WHERE session_id = ? AND ${INCLUDED} ORDER BY participant_no`,
        )
        .all(s.id, s.closed_at, s.closed_at) as {
        participant_no: number
        created_at: string
        updated_at: string
      }[]
      const total = (
        db
          .prepare('SELECT COUNT(*) AS n FROM submissions WHERE session_id = ?')
          .get(s.id) as { n: number }
      ).n
      return {
        session: { ...publicSession(s), adminKey: s.admin_key },
        submissionCount: subs.length,
        excludedCount: total - subs.length,
        submissions: subs.map((r) => ({
          participantNo: r.participant_no,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      }
    },
  )

  /**
   * GET /api/admin/:adminKey/analysis — analysis dashboard data; only after closing.
   *
   * @returns {object} `{ cards, schemas, cardSetVersion, closedAt, analysis }`;
   *   `409 session_open`.
   */
  app.get<{ Params: { adminKey: string } }>(
    '/api/admin/:adminKey/analysis',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      if (s.closed_at === null) return reply.code(409).send({ error: 'session_open' })
      return {
        cards,
        schemas,
        cardSetVersion: CARD_SET_VERSION,
        closedAt: s.closed_at,
        analysis: analysisFromRows(includedRows(s)),
      }
    },
  )

  /**
   * GET /api/admin/:adminKey/export.json — download: raw data of all submissions with
   * `included` flag, or groups per submission with `?kind=groups`.
   *
   * @returns {object} JSON attachment.
   */
  app.get<{ Params: { adminKey: string }; Querystring: { kind?: string } }>(
    '/api/admin/:adminKey/export.json',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      if (req.query.kind === 'groups') {
        reply.header(
          'Content-Disposition',
          `attachment; filename="gruppen_${s.session_key}.json"`,
        )
        return groupsJson([
          { sessionKey: s.session_key, analysis: analysisFromRows(includedRows(s)) },
        ])
      }
      // Without `receipt_id` (invariant in db.ts).
      const subs = db
        .prepare(
          'SELECT participant_no, state_json, created_at, updated_at FROM submissions WHERE session_id = ? ORDER BY participant_no',
        )
        .all(s.id) as {
        participant_no: number
        state_json: string
        created_at: string
        updated_at: string
      }[]
      reply.header(
        'Content-Disposition',
        `attachment; filename="rohdaten_${s.session_key}.json"`,
      )
      return {
        session: publicSession(s),
        submissions: subs.map((r) => ({
          participantNo: r.participant_no,
          state: JSON.parse(r.state_json),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          included: s.closed_at === null || r.created_at <= s.closed_at,
        })),
      }
    },
  )

  /**
   * GET /api/admin/:adminKey/export.csv — download over included submissions:
   * aggregate matrix (default), `?kind=metrics` or `?kind=names`.
   *
   * @returns {string} CSV attachment.
   */
  app.get<{ Params: { adminKey: string }; Querystring: { kind?: string } }>(
    '/api/admin/:adminKey/export.csv',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      const rows = includedRows(s)
      const kind = req.query.kind ?? 'matrix'
      reply.header('Content-Type', 'text/csv; charset=utf-8')
      if (kind === 'metrics' || kind === 'names') {
        const sessions = [{ sessionKey: s.session_key, analysis: analysisFromRows(rows) }]
        reply.header(
          'Content-Disposition',
          `attachment; filename="${kind === 'metrics' ? 'kennwerte' : 'gruppennamen'}_${s.session_key}.csv"`,
        )
        return kind === 'metrics' ? metricsCsv(sessions) : namesCsv(sessions, false)
      }
      reply.header(
        'Content-Disposition',
        `attachment; filename="aggregat_${s.session_key}.csv"`,
      )
      return withMeta(
        { submissions: rows.length, sessions: [s.session_key], cardSetVersion: CARD_SET_VERSION },
        aggregateCsvFromStates(rows.map((r) => r.state_json)),
      )
    },
  )

  /**
   * POST /api/admin/:adminKey/close — closes the session; later submissions are excluded.
   *
   * @returns {object} `{ closedAt }`.
   */
  app.post<{ Params: { adminKey: string } }>(
    '/api/admin/:adminKey/close',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      const now = new Date().toISOString()
      db.prepare(
        "UPDATE sessions SET closed_at = ?, status = 'closed', updated_at = ? WHERE id = ?",
      ).run(now, now, s.id)
      return { closedAt: now }
    },
  )

  /**
   * POST /api/admin/:adminKey/reopen — reopens the session; all submissions count again.
   *
   * @returns {object} `{ closedAt: null }`.
   */
  app.post<{ Params: { adminKey: string } }>(
    '/api/admin/:adminKey/reopen',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      const now = new Date().toISOString()
      db.prepare(
        "UPDATE sessions SET closed_at = NULL, status = 'open', updated_at = ? WHERE id = ?",
      ).run(now, s.id)
      return { closedAt: null }
    },
  )

  /**
   * POST /api/admin/:adminKey/settings — updates session settings.
   *
   * @returns {object} `{ ok: true, requiresStudentId: boolean }`.
   */
  app.post<{ Params: { adminKey: string }; Body: { requiresStudentId?: boolean } }>(
    '/api/admin/:adminKey/settings',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      const requiresStudentId = req.body.requiresStudentId ?? false
      const now = new Date().toISOString()
      db.prepare(
        'UPDATE sessions SET requires_student_id = ?, updated_at = ? WHERE id = ?',
      ).run(requiresStudentId ? 1 : 0, now, s.id)
      return { ok: true, requiresStudentId }
    },
  )

  /**
   * DELETE /api/admin/:adminKey — deletes the session with all its submissions.
   *
   * @returns {object} `{ ok: true }`.
   */
  app.delete<{ Params: { adminKey: string } }>(
    '/api/admin/:adminKey',
    async (req, reply) => {
      const s = findSessionByAdminKey(req.params.adminKey)
      if (!s) return reply.code(404).send({ error: 'not_found' })
      db.prepare('DELETE FROM submissions WHERE session_id = ?').run(s.id)
      db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id)
      return { ok: true }
    },
  )
}
