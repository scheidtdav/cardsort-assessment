import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { db } from '../db'
import {
  generateSessionKey,
  generateAdminKey,
  normalizeAdminKey,
  isValidAdminKey,
  randomUUID,
} from '../util'
import { CARD_SET_VERSION } from '../cards'

/**
 * Body of `POST /api/sessions`.
 *
 * @property {string} klassenstufe Grade level.
 * @property {string} schulform School type.
 * @property {string} mlVorwissen Prior ML knowledge of the class.
 * @property {string} [bundesland] Federal state.
 * @property {string} [note] Free-text note of the teacher.
 * @property {string} [adminKey] Self-chosen admin key; generated if empty.
 * @property {boolean} [requiresStudentId] Whether student ID is required for submissions.
 */
interface CreateBody {
  klassenstufe: string
  schulform: string
  mlVorwissen: string
  bundesland?: string
  note?: string
  adminKey?: string
  requiresStudentId?: boolean
}

/** Fastify validation schema of {@link CreateBody}. */
const createSchema = {
  body: {
    type: 'object',
    required: ['klassenstufe', 'schulform', 'mlVorwissen'],
    additionalProperties: false,
    properties: {
      klassenstufe: { type: 'string', minLength: 1 },
      schulform: { type: 'string', minLength: 1 },
      mlVorwissen: { type: 'string', minLength: 1 },
      bundesland: { type: 'string' },
      note: { type: 'string' },
      adminKey: { type: 'string' },
      requiresStudentId: { type: 'boolean' },
    },
  },
}

/**
 * Body of `POST /api/sessions/:key/submissions`.
 *
 * @property {string} [receipt] Receipt of an earlier own submission; missing on first submit.
 * @property {unknown} state Sort state in relative coordinates, validated by the schema.
 * @property {string} [studentId] Student identifier/pseudonym; required if session requires it.
 */
interface SubmitBody {
  receipt?: string
  state: unknown
  studentId?: string
}

/** Fastify validation schema of {@link SubmitBody} including the full `SortState`. */
const submitSchema = {
  body: {
    type: 'object',
    required: ['state'],
    additionalProperties: false,
    properties: {
      receipt: { type: 'string', minLength: 1 },
      studentId: { type: 'string', minLength: 1 },
      state: {
        type: 'object',
        required: ['placements', 'groups', 'canvas'],
        additionalProperties: false,
        properties: {
          // New SortState fields MUST be added here: `additionalProperties: false` silently
          // drops unknown fields.
          lang: { type: 'string', enum: ['de', 'en'] },
          studentId: { type: 'string', minLength: 1 },
          canvas: {
            type: 'object',
            required: ['width', 'height'],
            additionalProperties: false,
            properties: {
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          placements: {
            type: 'array',
            items: {
              type: 'object',
              required: ['cardId', 'onCanvas', 'x', 'y', 'groupId'],
              additionalProperties: false,
              properties: {
                cardId: { type: 'string' },
                onCanvas: { type: 'boolean' },
                x: { type: 'number' },
                y: { type: 'number' },
                groupId: { type: ['string', 'null'] },
              },
            },
          },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'name', 'color', 'x', 'y', 'width', 'height'],
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                color: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
}

/**
 * Public API without authentication: create a session, check a session key, submit a sorting.
 *
 * @param {FastifyInstance} app Fastify instance.
 * @returns {Promise<void>}
 */
export const sessionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/sessions — creates a session with fresh session key and generated or self-chosen
   * admin key.
   *
   * @returns {object} `201 { sessionKey, adminKey }`; `400 invalid_admin_key`,
   *   `409 admin_key_taken`.
   */
  app.post<{ Body: CreateBody }>(
    '/api/sessions',
    { schema: createSchema },
    async (req, reply) => {
      const { klassenstufe, schulform, mlVorwissen, bundesland, note, requiresStudentId } = req.body
      const id = randomUUID()
      const now = new Date().toISOString()

      // Case-insensitive, because the login compares with COLLATE NOCASE.
      const adminKeyExists = db.prepare(
        'SELECT 1 FROM sessions WHERE admin_key = ? COLLATE NOCASE',
      )

      let adminKey: string
      if (req.body.adminKey !== undefined && req.body.adminKey.trim() !== '') {
        adminKey = normalizeAdminKey(req.body.adminKey)
        if (!isValidAdminKey(adminKey)) {
          return reply.code(400).send({ error: 'invalid_admin_key' })
        }
        if (adminKeyExists.get(adminKey)) {
          return reply.code(409).send({ error: 'admin_key_taken' })
        }
      } else {
        adminKey = generateAdminKey()
        for (let i = 0; i < 10 && adminKeyExists.get(adminKey); i++) {
          adminKey = generateAdminKey()
        }
      }

      const keyExists = db.prepare('SELECT 1 FROM sessions WHERE session_key = ?')
      let sessionKey = generateSessionKey()
      for (let i = 0; i < 10 && keyExists.get(sessionKey); i++) {
        sessionKey = generateSessionKey()
      }

      db.prepare(
        `INSERT INTO sessions
          (id, session_key, admin_key, status, card_set_version,
            klassenstufe, schulform, ml_vorwissen, bundesland, note, requires_student_id, created_at, updated_at)
        VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        sessionKey,
        adminKey,
        CARD_SET_VERSION,
        klassenstufe,
        schulform,
        mlVorwissen,
        bundesland ?? null,
        note ?? null,
        requiresStudentId ? 1 : 0,
        now,
        now,
      )

      return reply.code(201).send({ sessionKey, adminKey })
    },
  )

  /**
   * GET /api/sessions/:key — checks a session key before joining.
   *
   * @returns {object} `{ status, cardSetVersion, requiresStudentId }`; `404 not_found`.
   */
  app.get<{ Params: { key: string } }>(
    '/api/sessions/:key',
    async (req, reply) => {
      const row = db
        .prepare('SELECT status, card_set_version, requires_student_id FROM sessions WHERE session_key = ?')
        .get(req.params.key) as
        | { status: string; card_set_version: string; requires_student_id: number }
        | undefined
      if (!row) return reply.code(404).send({ error: 'not_found' })
      return { status: row.status, cardSetVersion: row.card_set_version, requiresStudentId: row.requires_student_id === 1 }
    },
  )

  /**
   * POST /api/sessions/:key/submissions — upserts a sorting. A known receipt updates the own
   * submission; otherwise a new one with the next `participant_no` and a fresh receipt is created
   * (an unknown receipt falls back to a new one).
   *
   * After closing, included submissions are frozen (update acknowledged but discarded) and new
   * submissions are stored but excluded.
   *
   * @returns {object} `201`/`200 { ok, receipt, participantNo, included }`, `200 { ok, frozen }`
   *   for frozen updates; `404 not_found`.
   */
  app.post<{ Params: { key: string }; Body: SubmitBody }>(
    '/api/sessions/:key/submissions',
    { schema: submitSchema },
    async (req, reply) => {
      const session = db
        .prepare('SELECT id, closed_at, requires_student_id FROM sessions WHERE session_key = ?')
        .get(req.params.key) as { id: string; closed_at: string | null; requires_student_id: number } | undefined
      if (!session) return reply.code(404).send({ error: 'not_found' })

      // Validate studentId if required by session
      const requiresStudentId = session.requires_student_id === 1
      const studentId = req.body.studentId ?? (req.body.state as { studentId?: string })?.studentId
      if (requiresStudentId && !studentId?.trim()) {
        return reply.code(400).send({ error: 'student_id_required' })
      }

      // Extract studentId from state if provided there (for backward compatibility)
      const state = req.body.state as { studentId?: string }
      const effectiveStudentId = studentId ?? state.studentId ?? null

      const stateJson = JSON.stringify(req.body.state)
      const now = new Date().toISOString()

      const existing = req.body.receipt
        ? (db
            .prepare(
              'SELECT id, participant_no, created_at FROM submissions WHERE session_id = ? AND receipt_id = ?',
            )
            .get(session.id, req.body.receipt) as
            | { id: string; participant_no: number; created_at: string }
            | undefined)
        : undefined

      if (existing) {
        if (session.closed_at && existing.created_at <= session.closed_at) {
          return reply.code(200).send({ ok: true, frozen: true })
        }
        db.prepare(
          'UPDATE submissions SET state_json = ?, student_id = ?, updated_at = ? WHERE id = ?',
        ).run(stateJson, effectiveStudentId, now, existing.id)
        return reply.code(200).send({
          ok: true,
          receipt: req.body.receipt,
          participantNo: existing.participant_no,
          included: session.closed_at === null,
        })
      }

      // Number and insert in ONE transaction, otherwise two concurrent submissions take the
      // same number.
      const receipt = randomUUID()
      db.exec('BEGIN IMMEDIATE')
      let participantNo: number
      try {
        participantNo =
          ((
            db
              .prepare(
                'SELECT MAX(participant_no) AS max_no FROM submissions WHERE session_id = ?',
              )
              .get(session.id) as { max_no: number | null }
          ).max_no ?? 0) + 1
        db.prepare(
          `INSERT INTO submissions
            (id, session_id, participant_no, receipt_id, state_json, student_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), session.id, participantNo, receipt, stateJson, effectiveStudentId, now, now)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }

      return reply.code(201).send({
        ok: true,
        receipt,
        participantNo,
        included: session.closed_at === null,
      })
    },
  )
}
