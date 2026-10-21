import type { SessionAnalysis, SessionComparison } from '@sortiertool/shared/analysis'
import type { CardSource, NameType, Schema, SortState } from './types'

/**
 * Client-side API calls with their response types: public session API, admin (admin key) and
 * master (master token). Failed requests throw {@link ApiError}, except where noted.
 */

/** API origin; empty = same origin (in dev, Vite proxies `/api`). */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

/**
 * Keys of a newly created session.
 *
 * @property {string} sessionKey Key students join with.
 * @property {string} adminKey Secret key of the teacher's admin view.
 */
export interface CreatedSession {
  sessionKey: string
  adminKey: string
}

/**
 * Class data entered when creating a session.
 *
 * @property {string} klassenstufe Grade.
 * @property {string} schulform School type.
 * @property {string} mlVorwissen Prior ML knowledge of the class.
 * @property {string} [bundesland] Federal state.
 * @property {string} [note] Free note.
 * @property {string} [adminKey] Self-chosen admin key; empty = the server generates one.
 * @property {boolean} [requiresStudentId] Whether student ID is required for submissions.
 */
export interface ClassInfo {
  klassenstufe: string
  schulform: string
  mlVorwissen: string
  bundesland?: string
  note?: string
  adminKey?: string
  requiresStudentId?: boolean
}

/**
 * Session as seen in the admin view.
 *
 * @property {string} sessionKey Key students join with.
 * @property {string} adminKey Admin key.
 * @property {'open' | 'closed'} status Whether submissions still count.
 * @property {string | null} closedAt ISO time of closing; `null` while the survey runs.
 * @property {string} cardSetVersion Card-set version at creation.
 * @property {boolean} cardSetOutdated Created with an older card set than the current one.
 * @property {string} klassenstufe Grade.
 * @property {string} schulform School type.
 * @property {string} mlVorwissen Prior ML knowledge.
 * @property {string | null} bundesland Federal state.
 * @property {string | null} note Free note.
 * @property {boolean} requiresStudentId Whether student ID is required for submissions.
 * @property {string} createdAt ISO creation time.
 * @property {string} updatedAt ISO time of the last change.
 */
export interface AdminSession {
  sessionKey: string
  adminKey: string
  status: 'open' | 'closed'
  closedAt: string | null
  cardSetVersion: string
  cardSetOutdated: boolean
  klassenstufe: string
  schulform: string
  mlVorwissen: string
  bundesland: string | null
  note: string | null
  requiresStudentId: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Overview of one session for the admin view.
 *
 * @property {AdminSession} session The session.
 * @property {number} submissionCount Counted submissions.
 * @property {number} excludedCount Submissions received after closing (not counted).
 * @property {{ participantNo: number; createdAt: string; updatedAt: string }[]} submissions
 *   Counted submissions only (number and timestamps).
 */
export interface AdminOverview {
  session: AdminSession
  submissionCount: number
  excludedCount: number
  submissions: { participantNo: number; createdAt: string; updatedAt: string }[]
}

/**
 * Analysis of one session. The dashboard must compute with the cards/schemas delivered here,
 * not the local ones, or it may deviate from the server analysis.
 *
 * @property {CardSource[]} cards Card set the analysis used.
 * @property {Schema[]} schemas Reference schemas the analysis used.
 * @property {string} cardSetVersion Current card-set version (the one `cards`/`schemas` belong
 *   to); the session's own version is in {@link AdminSession}.
 * @property {string | null} closedAt ISO time of closing.
 * @property {SessionAnalysis} analysis Computed analysis.
 */
export interface AnalysisData {
  cards: CardSource[]
  schemas: Schema[]
  cardSetVersion: string
  closedAt: string | null
  analysis: SessionAnalysis
}

/**
 * Error of a failed request, carrying the HTTP status for the callers to branch on.
 *
 * @property {number} status HTTP status code.
 */
export class ApiError extends Error {
  status: number
  /**
   * Creates the error for an HTTP status.
   *
   * @param {number} status HTTP status code.
   */
  constructor(status: number) {
    super(String(status))
    this.status = status
  }
}

/**
 * Parses a JSON response, throwing on non-2xx status.
 *
 * @template T
 * @param {Response} res Fetch response.
 * @returns {Promise<T>} Parsed body.
 * @throws {ApiError} When the status is not OK.
 */
async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status)
  return (await res.json()) as T
}

/**
 * `POST /api/sessions` — creates a session.
 *
 * @param {ClassInfo} info Class data and optional self-chosen admin key.
 * @returns {Promise<CreatedSession>} Session and admin key.
 * @throws {ApiError} E.g. `400` for an invalid or `409` for a taken admin key.
 */
export async function createSession(info: ClassInfo): Promise<CreatedSession> {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info),
  })
  return readJson<CreatedSession>(res)
}

/**
 * Public information on a session.
 *
 * @property {'open' | 'closed'} status Whether submissions still count.
 * @property {string} cardSetVersion Card-set version of the session.
 * @property {boolean} requiresStudentId Whether student ID is required for submissions.
 */
export interface PublicSession {
  status: 'open' | 'closed'
  cardSetVersion: string
  requiresStudentId: boolean
}

/**
 * `GET /api/sessions/:key` — checks a session key.
 *
 * @param {string} sessionKey Session key.
 * @returns {Promise<PublicSession>} Status and card-set version.
 * @throws {ApiError} `404` for an unknown key.
 */
export async function getSession(sessionKey: string): Promise<PublicSession> {
  const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionKey)}`)
  return readJson<PublicSession>(res)
}

/**
 * Reply to a submit.
 *
 * @property {true} ok Always `true`; failures throw.
 * @property {string} [receipt] Receipt to update the own submission later.
 * @property {number} [participantNo] Running number of the submission in the session.
 * @property {boolean} [included] `false`: saved, but received after closing (not counted).
 * @property {boolean} [frozen] The submission was counted before closing; this update was
 *   discarded.
 */
export interface SubmitResult {
  ok: true
  receipt?: string
  participantNo?: number
  included?: boolean
  frozen?: boolean
}

/**
 * `POST /api/sessions/:key/submissions` — submits a sorting; with a receipt, updates the own
 * submission instead of creating a new one.
 *
 * @param {string} sessionKey Session key.
 * @param {SortState} state Sorting in relative coordinates.
 * @param {string} [receipt] Receipt of an earlier own submission.
 * @returns {Promise<SubmitResult>} Server reply.
 * @throws {ApiError} `404` for an unknown session key.
 */
export async function submitSorting(
  sessionKey: string,
  state: SortState,
  receipt?: string,
): Promise<SubmitResult> {
  const res = await fetch(
    `${BASE}/api/sessions/${encodeURIComponent(sessionKey)}/submissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receipt ? { receipt, state } : { state }),
    },
  )
  return readJson<SubmitResult>(res)
}

/**
 * `GET /api/admin/:adminKey` — session overview for the admin view.
 *
 * @param {string} adminKey Admin key.
 * @returns {Promise<AdminOverview>} Session and its submissions.
 * @throws {ApiError} `404` for an unknown key.
 */
export async function getAdmin(adminKey: string): Promise<AdminOverview> {
  const res = await fetch(`${BASE}/api/admin/${encodeURIComponent(adminKey)}`)
  return readJson<AdminOverview>(res)
}

/**
 * `GET /api/admin/:adminKey/analysis` — analysis of a closed session.
 *
 * @param {string} adminKey Admin key.
 * @returns {Promise<AnalysisData>} Analysis with the cards and schemas it used.
 * @throws {ApiError} `404` for an unknown key, `409` while the survey is still running.
 */
export async function getAnalysis(adminKey: string): Promise<AnalysisData> {
  const res = await fetch(`${BASE}/api/admin/${encodeURIComponent(adminKey)}/analysis`)
  return readJson<AnalysisData>(res)
}

/**
 * `POST /api/admin/:adminKey/close` — closes the survey; later submissions no longer count.
 *
 * @param {string} adminKey Admin key.
 * @returns {Promise<void>}
 * @throws {Error} With the status code as message on failure.
 */
export async function closeSession(adminKey: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/${encodeURIComponent(adminKey)}/close`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(String(res.status))
}

/**
 * `POST /api/admin/:adminKey/reopen` — reopens the survey; all submissions count again.
 *
 * @param {string} adminKey Admin key.
 * @returns {Promise<void>}
 * @throws {Error} With the status code as message on failure.
 */
export async function reopenSession(adminKey: string): Promise<void> {
  const res = await fetch(
    `${BASE}/api/admin/${encodeURIComponent(adminKey)}/reopen`,
    { method: 'POST' },
  )
  if (!res.ok) throw new Error(String(res.status))
}

/**
 * `DELETE /api/admin/:adminKey` — deletes the session with all submissions.
 *
 * @param {string} adminKey Admin key.
 * @returns {Promise<void>}
 * @throws {Error} With the status code as message on failure.
 */
export async function deleteSession(adminKey: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/${encodeURIComponent(adminKey)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(String(res.status))
}

/**
 * Settings update for a session.
 *
 * @property {boolean} [requiresStudentId] Whether student ID is required for submissions.
 */
export interface SessionSettings {
  requiresStudentId?: boolean
}

/**
 * `POST /api/admin/:adminKey/settings` — updates session settings.
 *
 * @param {string} adminKey Admin key.
 * @param {SessionSettings} settings Settings to update.
 * @returns {Promise<{ ok: true; requiresStudentId: boolean }>} Confirmation with updated setting.
 * @throws {Error} With the status code as message on failure.
 */
export async function updateSessionSettings(
  adminKey: string,
  settings: SessionSettings,
): Promise<{ ok: true; requiresStudentId: boolean }> {
  const res = await fetch(`${BASE}/api/admin/${encodeURIComponent(adminKey)}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()) as { ok: true; requiresStudentId: boolean }
}

/** CSV exports: aggregate matrix, metrics per submission, group names. */
export type CsvKind = 'matrix' | 'metrics' | 'names'
/** JSON exports: raw submissions, groups per submission. */
export type JsonKind = 'raw' | 'groups'

/**
 * Download URL of a session's CSV export.
 *
 * @param {string} adminKey Admin key.
 * @param {CsvKind} [kind='matrix'] Export kind.
 * @returns {string} URL of `export.csv`.
 */
export function exportCsvUrl(adminKey: string, kind: CsvKind = 'matrix'): string {
  return `${BASE}/api/admin/${encodeURIComponent(adminKey)}/export.csv?kind=${kind}`
}

/**
 * Download URL of a session's JSON export.
 *
 * @param {string} adminKey Admin key.
 * @param {JsonKind} [kind='raw'] Export kind.
 * @returns {string} URL of `export.json`.
 */
export function exportJsonUrl(adminKey: string, kind: JsonKind = 'raw'): string {
  const qs = kind === 'raw' ? '' : `?kind=${kind}`
  return `${BASE}/api/admin/${encodeURIComponent(adminKey)}/export.json${qs}`
}

// --- Master analysis ---

/**
 * One row of the master overview over all sessions.
 *
 * @property {string} sessionKey Session key.
 * @property {'open' | 'closed'} status Whether submissions still count.
 * @property {string | null} closedAt ISO time of closing.
 * @property {string} cardSetVersion Card-set version at creation.
 * @property {boolean} cardSetOutdated Created with an older card set than the current one.
 * @property {string} klassenstufe Grade.
 * @property {string} schulform School type.
 * @property {string} mlVorwissen Prior ML knowledge.
 * @property {string | null} bundesland Federal state.
 * @property {string | null} note Free note.
 * @property {string} createdAt ISO creation time.
 * @property {number} submissionCount Counted submissions.
 * @property {number} excludedCount Submissions received after closing.
 * @property {string | null} lastActivityAt ISO time of the latest submission change.
 */
export interface MasterSession {
  sessionKey: string
  status: 'open' | 'closed'
  closedAt: string | null
  cardSetVersion: string
  cardSetOutdated: boolean
  klassenstufe: string
  schulform: string
  mlVorwissen: string
  bundesland: string | null
  note: string | null
  createdAt: string
  submissionCount: number
  excludedCount: number
  lastActivityAt: string | null
}

/**
 * `GET /api/master/:token` — overview of all sessions.
 *
 * @param {string} masterToken Master token.
 * @returns {Promise<{ sessions: MasterSession[] }>} All sessions.
 * @throws {ApiError} For an invalid token.
 */
export async function getMaster(
  masterToken: string,
): Promise<{ sessions: MasterSession[] }> {
  const res = await fetch(`${BASE}/api/master/${encodeURIComponent(masterToken)}`)
  return readJson<{ sessions: MasterSession[] }>(res)
}

/**
 * Analysis of several sessions, each analysed on its own (not pooled).
 *
 * @property {CardSource[]} cards Card set the analysis used.
 * @property {Schema[]} schemas Reference schemas the analysis used.
 * @property {string} cardSetVersion Current card-set version.
 * @property {NameType[]} nameTypes Legend of `NameStat.type`.
 * @property {{ session: MasterSession; analysis: SessionAnalysis }[]} sessions Analysis per
 *   session.
 * @property {SessionComparison[]} comparison Class means per session side by side.
 */
export interface MasterAnalysis {
  cards: CardSource[]
  schemas: Schema[]
  cardSetVersion: string
  nameTypes: NameType[]
  sessions: { session: MasterSession; analysis: SessionAnalysis }[]
  comparison: SessionComparison[]
}

/**
 * `GET /api/master/:token/analysis` — analysis of selected sessions.
 *
 * @param {string} masterToken Master token.
 * @param {string[]} [keys] Session keys; omitted = all sessions except the default session.
 * @returns {Promise<MasterAnalysis>} Analysis per session plus comparison.
 * @throws {ApiError} For an invalid token.
 */
export async function getMasterAnalysis(
  masterToken: string,
  keys?: string[],
): Promise<MasterAnalysis> {
  const qs = keys ? `?keys=${encodeURIComponent(keys.join(','))}` : ''
  const res = await fetch(
    `${BASE}/api/master/${encodeURIComponent(masterToken)}/analysis${qs}`,
  )
  return readJson<MasterAnalysis>(res)
}

/**
 * Download URL of a master export.
 *
 * @param {string} masterToken Master token.
 * @param {'export.csv' | 'export.json'} file Export file.
 * @param {object} [params] Query parameters.
 * @param {string[]} [params.keys] Session keys; omitted = all except the default session.
 * @param {string} [params.kind] Export kind; omitted = the route's default.
 * @returns {string} Export URL.
 */
function masterExportUrl(
  masterToken: string,
  file: 'export.csv' | 'export.json',
  params: { keys?: string[]; kind?: string } = {},
): string {
  const qs = new URLSearchParams()
  if (params.keys) qs.set('keys', params.keys.join(','))
  if (params.kind) qs.set('kind', params.kind)
  const query = qs.toString()
  return `${BASE}/api/master/${encodeURIComponent(masterToken)}/${file}${
    query ? `?${query}` : ''
  }`
}

/**
 * Download URL of a master CSV export.
 *
 * @param {string} masterToken Master token.
 * @param {CsvKind | 'sessions'} kind Export kind; `sessions` = session overview.
 * @param {string[]} [keys] Session keys; omitted = all except the default session.
 * @returns {string} URL of `export.csv`.
 */
export function masterCsvUrl(
  masterToken: string,
  kind: CsvKind | 'sessions',
  keys?: string[],
): string {
  return masterExportUrl(masterToken, 'export.csv', { kind, keys })
}

/**
 * Download URL of a master JSON export.
 *
 * @param {string} masterToken Master token.
 * @param {string[]} [keys] Session keys; omitted = all except the default session.
 * @param {JsonKind} [kind='raw'] Export kind.
 * @returns {string} URL of `export.json`.
 */
export function masterJsonUrl(masterToken: string, keys?: string[], kind: JsonKind = 'raw'): string {
  return masterExportUrl(masterToken, 'export.json', { keys, kind: kind === 'raw' ? undefined : kind })
}
