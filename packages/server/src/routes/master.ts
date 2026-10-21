import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import { db, getMasterToken } from '../db'
import { safeEqual } from '../util'
import { aggregateCsvFromStates, analysisFromRows } from '../results'
import { CARD_SET_VERSION, cards, isCardSetOutdated, nameMarkers, schemas } from '../cards'
import { csvFile, withMeta } from '../csv'
import { groupsJson, metricsCsv, namesCsv } from '../exports'
import { DEFAULT_SESSION_KEY } from '@sortiertool/shared/constants'
import { compareSessions } from '@sortiertool/shared/analysis'

/**
 * Session row of the master overview, with submission counts.
 *
 * @property {string} id Internal session id.
 * @property {string} session_key Session key learners join with.
 * @property {string} status `open` or `closed`.
 * @property {string | null} closed_at ISO timestamp of closing, `null` while running.
 * @property {string} card_set_version Card-set version at creation.
 * @property {string} klassenstufe Grade level.
 * @property {string} schulform School type.
 * @property {string} ml_vorwissen Prior ML knowledge.
 * @property {string | null} bundesland Federal state.
 * @property {string | null} note Teacher's note.
 * @property {string} created_at ISO creation timestamp.
 * @property {number} submission_count Included submissions.
 * @property {number} excluded_count Submissions after closing.
 * @property {string | null} last_activity_at Last update of any submission, unfiltered.
 */
interface OverviewRow {
  id: string
  session_key: string
  status: string
  closed_at: string | null
  card_set_version: string
  klassenstufe: string
  schulform: string
  ml_vorwissen: string
  bundesland: string | null
  note: string | null
  created_at: string
  submission_count: number
  excluded_count: number
  last_activity_at: string | null
}

/**
 * Inclusion rule of admin.ts (`INCLUDED`) as JOIN expressions, since `closed_at` varies per
 * session.
 *
 * `sub.id IS NOT NULL` is mandatory: without submissions the LEFT JOIN yields a NULL row that
 * open sessions would otherwise count as 1.
 */
const INCLUDED_JOIN =
  '(sub.id IS NOT NULL AND (s.closed_at IS NULL OR sub.created_at <= s.closed_at))'
const EXCLUDED_JOIN =
  '(sub.id IS NOT NULL AND s.closed_at IS NOT NULL AND sub.created_at > s.closed_at)'

/**
 * All sessions with counts, newest first.
 *
 * @returns {OverviewRow[]} Overview rows.
 */
function overviewRows(): OverviewRow[] {
  return db
    .prepare(
      `SELECT s.id, s.session_key, s.status, s.closed_at, s.card_set_version, s.klassenstufe,
              s.schulform, s.ml_vorwissen, s.bundesland, s.note, s.created_at,
              COUNT(CASE WHEN ${INCLUDED_JOIN} THEN 1 END) AS submission_count,
              COUNT(CASE WHEN ${EXCLUDED_JOIN} THEN 1 END) AS excluded_count,
              -- bewusst UNGEFILTERT: „letzte Aktivität" ist ein Betriebssignal
              -- („kommt da noch was?"), kein Auswertungsaggregat.
              MAX(sub.updated_at) AS last_activity_at
       FROM sessions s
       LEFT JOIN submissions sub ON sub.session_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
    )
    .all() as unknown as OverviewRow[]
}

/**
 * Selects sessions by the `keys` query parameter.
 *
 * @param {OverviewRow[]} rows All sessions.
 * @param {string | undefined} keysParam Comma-separated session keys; without it all sessions
 *   except the default session, which is only included when named explicitly.
 * @returns {OverviewRow[]} Selected sessions.
 */
function filterByKeys(rows: OverviewRow[], keysParam: string | undefined): OverviewRow[] {
  if (keysParam === undefined) return rows.filter((r) => r.session_key !== DEFAULT_SESSION_KEY)
  const wanted = new Set(
    keysParam
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  )
  return rows.filter((r) => wanted.has(r.session_key))
}

/**
 * Session as returned to the master client (camel-cased, with counts and `cardSetOutdated`).
 *
 * @param {OverviewRow} r Overview row.
 * @returns {object} Public session fields.
 */
function publicSession(r: OverviewRow) {
  return {
    sessionKey: r.session_key,
    status: r.status,
    closedAt: r.closed_at,
    cardSetVersion: r.card_set_version,
    cardSetOutdated: isCardSetOutdated(r.card_set_version),
    klassenstufe: r.klassenstufe,
    schulform: r.schulform,
    mlVorwissen: r.ml_vorwissen,
    bundesland: r.bundesland,
    note: r.note,
    createdAt: r.created_at,
    submissionCount: r.submission_count,
    excludedCount: r.excluded_count,
    lastActivityAt: r.last_activity_at,
  }
}

/** Columns of the sessions CSV; `abgaben` counts included submissions only. */
const SESSIONS_CSV_HEADER = [
  'sessionKey',
  'klassenstufe',
  'schulform',
  'mlVorwissen',
  'bundesland',
  'status',
  'abgeschlossenAm',
  'abgaben',
  'abgabenAusgeschlossen',
  'angelegt',
  'letzteAktivitaet',
  'kartensatz',
  'notiz',
]

/**
 * Sessions CSV: one row per session with metadata and counts.
 *
 * @param {OverviewRow[]} rows Selected sessions.
 * @returns {string} CSV file.
 */
function buildSessionsCsv(rows: OverviewRow[]): string {
  return csvFile(
    {
      submissions: rows.reduce((n, r) => n + r.submission_count, 0),
      sessions: rows.map((r) => r.session_key),
      cardSetVersion: CARD_SET_VERSION,
    },
    SESSIONS_CSV_HEADER,
    rows.map((r) => [
      r.session_key,
      r.klassenstufe,
      r.schulform,
      r.ml_vorwissen,
      r.bundesland,
      r.status,
      r.closed_at,
      r.submission_count,
      r.excluded_count,
      r.created_at,
      r.last_activity_at,
      r.card_set_version,
      r.note,
    ]),
  )
}

/**
 * Submission row across sessions.
 *
 * @property {string} session_id Internal session id.
 * @property {number} participant_no Sequential number within the session.
 * @property {string} state_json Serialized sort state.
 * @property {string | null} student_id Optional student identifier/pseudonym.
 * @property {string} created_at ISO timestamp of the first submission.
 * @property {string} updated_at ISO timestamp of the last update.
 * @property {number} included `1` if submitted before closing, else `0`.
 */
interface SubRow {
  session_id: string
  participant_no: number
  state_json: string
  student_id: string | null
  created_at: string
  updated_at: string
  included: number
}

/**
 * All submissions of the given sessions, without `receipt_id` (invariant in db.ts).
 *
 * `included` is computed here rather than by callers, so no export path can skip the
 * inclusion rule.
 *
 * @param {string[]} ids Internal session ids.
 * @returns {SubRow[]} Submissions ordered by session and participant number.
 */
function submissionsForSessions(ids: string[]): SubRow[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT sub.session_id, sub.participant_no, sub.state_json, sub.student_id,
              sub.created_at, sub.updated_at,
              CASE WHEN s.closed_at IS NULL OR sub.created_at <= s.closed_at
                   THEN 1 ELSE 0 END AS included
       FROM submissions sub
       JOIN sessions s ON s.id = sub.session_id
       WHERE sub.session_id IN (${placeholders})
       ORDER BY sub.session_id, sub.participant_no`,
    )
    .all(...ids) as unknown as SubRow[]
}

/**
 * Groups submissions by session id.
 *
 * @param {SubRow[]} subs Submissions.
 * @returns {Map<string, SubRow[]>} Submissions per session id.
 */
function groupBySession(subs: SubRow[]): Map<string, SubRow[]> {
  const bySession = new Map<string, SubRow[]>()
  for (const s of subs) {
    const list = bySession.get(s.session_id) ?? []
    list.push(s)
    bySession.set(s.session_id, list)
  }
  return bySession
}

/**
 * Analyses each session over its included submissions, with name pre-coding.
 *
 * @param {OverviewRow[]} rows Selected sessions.
 * @returns {object[]} One `{ row, sessionKey, analysis }` per session.
 */
function analysedSessions(rows: OverviewRow[]) {
  const subsBySession = groupBySession(submissionsForSessions(rows.map((r) => r.id)))
  return rows.map((r) => ({
    row: r,
    sessionKey: r.session_key,
    analysis: analysisFromRows(
      (subsBySession.get(r.id) ?? []).filter((s) => s.included === 1),
      true,
    ),
  }))
}

/**
 * Master/research API across ALL sessions, authorized by the master token in the path.
 * Selection via `?keys=` (see {@link filterByKeys}).
 *
 * @param {FastifyInstance} app Fastify instance.
 * @returns {Promise<void>}
 */
export const masterRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Rejects an invalid master token with 404 (not 401), so the endpoint's existence is not
   * revealed.
   *
   * @param {string} token Token from the URL.
   * @param {FastifyReply} reply Reply to send the 404 on.
   * @returns {boolean} `true` if the request was rejected.
   */
  function denyIfInvalid(token: string, reply: FastifyReply): boolean {
    if (safeEqual(token, getMasterToken())) return false
    reply.code(404).send({ error: 'not_found' })
    return true
  }

  /**
   * GET /api/master/:token — overview of all sessions.
   *
   * @returns {object} `{ sessions }`.
   */
  app.get<{ Params: { token: string } }>(
    '/api/master/:token',
    async (req, reply) => {
      if (denyIfInvalid(req.params.token, reply)) return
      return { sessions: overviewRows().map(publicSession) }
    },
  )

  /**
   * GET /api/master/:token/export.json — download: raw data of the selected sessions with
   * `included` flags, or groups per submission with `?kind=groups`.
   *
   * @returns {object} JSON attachment.
   */
  app.get<{ Params: { token: string }; Querystring: { keys?: string; kind?: string } }>(
    '/api/master/:token/export.json',
    async (req, reply) => {
      if (denyIfInvalid(req.params.token, reply)) return
      const rows = filterByKeys(overviewRows(), req.query.keys)
      const stamp = new Date().toISOString().slice(0, 10)
      if (req.query.kind === 'groups') {
        reply.header(
          'Content-Disposition',
          `attachment; filename="gruppen_gesamt_${stamp}.json"`,
        )
        return groupsJson(analysedSessions(rows))
      }
      const subsBySession = groupBySession(submissionsForSessions(rows.map((r) => r.id)))
      reply.header(
        'Content-Disposition',
        `attachment; filename="rohdaten_gesamt_${stamp}.json"`,
      )
      return {
        exportedAt: new Date().toISOString(),
        cardSetVersion: CARD_SET_VERSION,
        sessionCount: rows.length,
        submissionCount: rows.reduce((n, r) => n + r.submission_count, 0),
        excludedCount: rows.reduce((n, r) => n + r.excluded_count, 0),
        sessions: rows.map((r) => ({
          ...publicSession(r),
          submissions: (subsBySession.get(r.id) ?? []).map((s) => ({
            participantNo: s.participant_no,
            state: JSON.parse(s.state_json),
            createdAt: s.created_at,
            updatedAt: s.updated_at,
            included: s.included === 1,
          })),
        })),
      }
    },
  )

  /**
   * GET /api/master/:token/analysis — analysis per selected session plus the session comparison.
   *
   * @returns {object} `{ cards, schemas, cardSetVersion, nameTypes, sessions, comparison }`.
   */
  app.get<{ Params: { token: string }; Querystring: { keys?: string } }>(
    '/api/master/:token/analysis',
    async (req, reply) => {
      if (denyIfInvalid(req.params.token, reply)) return
      const analysed = analysedSessions(filterByKeys(overviewRows(), req.query.keys))
      return {
        cards,
        schemas,
        cardSetVersion: CARD_SET_VERSION,
        nameTypes: nameMarkers.types,
        sessions: analysed.map((a) => ({ session: publicSession(a.row), analysis: a.analysis })),
        comparison: compareSessions(analysed),
      }
    },
  )

  /**
   * GET /api/master/:token/export.csv — download over the selected sessions: aggregate matrix
   * (default), `?kind=sessions`, `?kind=metrics` or `?kind=names` (with pre-coding).
   *
   * @returns {string} CSV attachment.
   */
  app.get<{ Params: { token: string }; Querystring: { keys?: string; kind?: string } }>(
    '/api/master/:token/export.csv',
    async (req, reply) => {
      if (denyIfInvalid(req.params.token, reply)) return
      const rows = filterByKeys(overviewRows(), req.query.keys)
      const stamp = new Date().toISOString().slice(0, 10)
      reply.header('Content-Type', 'text/csv; charset=utf-8')

      if (req.query.kind === 'sessions') {
        reply.header(
          'Content-Disposition',
          `attachment; filename="sitzungen_${stamp}.csv"`,
        )
        return buildSessionsCsv(rows)
      }
      if (req.query.kind === 'metrics' || req.query.kind === 'names') {
        const analysed = analysedSessions(rows)
        reply.header(
          'Content-Disposition',
          `attachment; filename="${req.query.kind === 'metrics' ? 'kennwerte' : 'gruppennamen'}_gesamt_${stamp}.csv"`,
        )
        return req.query.kind === 'metrics' ? metricsCsv(analysed) : namesCsv(analysed, true)
      }

      const stateJsons = submissionsForSessions(rows.map((r) => r.id))
        .filter((s) => s.included === 1)
        .map((s) => s.state_json)
      reply.header(
        'Content-Disposition',
        `attachment; filename="aggregat_gesamt_${stamp}.csv"`,
      )
      return withMeta(
        {
          submissions: stateJsons.length,
          sessions: rows.map((r) => r.session_key),
          cardSetVersion: CARD_SET_VERSION,
        },
        aggregateCsvFromStates(stateJsons),
      )
    },
  )
}
