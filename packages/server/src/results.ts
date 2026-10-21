import type { CardPlacement, SortState } from '@sortiertool/shared/types'
import { buildAggregateCsv } from '@sortiertool/shared/cooccurrence'
import { analyzeSession } from '@sortiertool/shared/analysis'
import type { SessionAnalysis } from '@sortiertool/shared/analysis'
import { cards, nameMarkers, schemas } from './cards'

/**
 * Bridge from the stored raw submissions (`state_json`) to the shared analysis.
 */

/**
 * Parses stored states down to their placements.
 *
 * @param {string[]} stateJsons Stored `state_json` values.
 * @returns {{ placements: CardPlacement[] }[]} Placements per submission.
 */
function parseStates(stateJsons: string[]): { placements: CardPlacement[] }[] {
  return stateJsons.map((json) => {
    const parsed = JSON.parse(json) as { placements: CardPlacement[] }
    return { placements: parsed.placements }
  })
}

/**
 * Aggregate co-occurrence matrix of stored submissions as CSV.
 *
 * @param {string[]} stateJsons Stored `state_json` values.
 * @returns {string} CSV over the canonical card set.
 */
export function aggregateCsvFromStates(stateJsons: string[]): string {
  return buildAggregateCsv(cards, parseStates(stateJsons))
}

/**
 * Submission row as read from the `submissions` table.
 *
 * @property {number} participant_no Sequential number within the session.
 * @property {string} state_json Serialized {@link SortState}.
 * @property {string} created_at ISO timestamp of the first submission.
 * @property {string} updated_at ISO timestamp of the last update.
 * @property {string | null} student_id Optional student identifier/pseudonym.
 */
export interface SubmissionRow {
  participant_no: number
  state_json: string
  created_at: string
  updated_at: string
  student_id: string | null
}

/**
 * Full analysis of a session from its stored submissions.
 *
 * @param {SubmissionRow[]} rows Included submissions of the session.
 * @param {boolean} [withNameTypes=false] Whether to pre-code group names (research view only).
 * @returns {SessionAnalysis} Analysis as shown in the dashboard.
 */
export function analysisFromRows(rows: SubmissionRow[], withNameTypes = false): SessionAnalysis {
  return analyzeSession(
    cards,
    schemas,
    rows.map((r) => ({
      participantNo: r.participant_no,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      state: JSON.parse(r.state_json) as SortState,
      studentId: r.student_id,
    })),
    withNameTypes ? nameMarkers : undefined,
  )
}
