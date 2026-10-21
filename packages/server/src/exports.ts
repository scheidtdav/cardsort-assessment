import { codeName, normalizeName, usableSchemas } from '@sortiertool/shared/analysis'
import type { SessionAnalysis } from '@sortiertool/shared/analysis'
import { CARD_SET_VERSION, cards, nameMarkers, schemas } from './cards'
import { csvFile } from './csv'
import type { CsvMeta, CsvValue } from './csv'

/**
 * Analysis exports (metrics per submission, group names, groups per submission).
 *
 * All metrics come from a {@link SessionAnalysis} and are never recomputed, so dashboard and
 * export cannot diverge; only name normalization and pre-coding per group are derived here with
 * the shared functions.
 */

/**
 * One analysed session as input of an export.
 *
 * @property {string} sessionKey Session key, written as `sitzung` column.
 * @property {SessionAnalysis} analysis Analysis of its included submissions.
 */
export interface ExportSession {
  sessionKey: string
  analysis: SessionAnalysis
}

/**
 * Rounds a metric to 6 decimals for export.
 *
 * @param {number | null} x Value to round.
 * @returns {number | null} Rounded value, `null` stays `null`.
 */
const round = (x: number | null): number | null => (x === null ? null : Number(x.toFixed(6)))

/**
 * CSV provenance for a set of exported sessions.
 *
 * @param {ExportSession[]} sessions Exported sessions.
 * @returns {CsvMeta} Submission count, session keys and card-set version.
 */
function meta(sessions: ExportSession[]): CsvMeta {
  return {
    submissions: sessions.reduce((n, s) => n + s.analysis.submissionCount, 0),
    sessions: sessions.map((s) => s.sessionKey),
    cardSetVersion: CARD_SET_VERSION,
  }
}

/**
 * Metrics CSV: one row per submission with hit/separation rate, score and ARI per usable
 * schema, hit rate per category, best schema(s) (ties joined with `|`) and deep-structure lead.
 *
 * @param {ExportSession[]} sessions Sessions to export.
 * @returns {string} CSV file.
 */
export function metricsCsv(sessions: ExportSession[]): string {
  const usable = usableSchemas(cards, schemas)
  const header = ['sitzung', 'nr', 'student_id', 'sprache', 'gruppen']
  for (const s of usable) {
    header.push(`${s.key}_treffer`, `${s.key}_trenn`, `${s.key}_score`, `${s.key}_ari`)
  }
  for (const s of usable) {
    for (const c of s.categories) header.push(`${s.key}_treffer_${c.key}`)
  }
  header.push('bestes_schema', 'netto_vorsprung')

  const rows: CsvValue[][] = []
  for (const { sessionKey, analysis } of sessions) {
    for (const sub of analysis.submissions) {
      const row: CsvValue[] = [sessionKey, sub.participantNo, sub.studentId ?? '', sub.lang ?? 'de', sub.groupCount]
      for (const s of usable) {
        const r = sub.schemas[s.key]
        row.push(round(r.hitRate), round(r.separationRate), round(r.score), round(r.ari))
      }
      for (const s of usable) {
        for (const rate of sub.schemas[s.key].categoryHitRates) row.push(round(rate))
      }
      row.push(sub.bestSchemas.join('|'), round(sub.deepStructureLead))
      rows.push(row)
    }
  }
  return csvFile(meta(sessions), header, rows)
}

/**
 * Group-names CSV: one row per non-empty group with raw and normalized name and its cards.
 *
 * @param {ExportSession[]} sessions Sessions to export.
 * @param {boolean} withCoding Whether to add the unchecked automatic pre-coding column.
 * @returns {string} CSV file.
 */
export function namesCsv(sessions: ExportSession[], withCoding: boolean): string {
  const header = ['sitzung', 'nr', 'name', 'name_normalisiert', 'karten', 'anzahl_karten']
  if (withCoding) header.push('vorkodierung_ungeprueft')
  const rows: CsvValue[][] = []
  for (const { sessionKey, analysis } of sessions) {
    for (const sub of analysis.submissions) {
      for (const g of sub.groups.groups) {
        if (g.cardIds.length === 0) continue
        const row: CsvValue[] = [
          sessionKey,
          sub.participantNo,
          g.name,
          normalizeName(g.name),
          g.cardIds.join(' '),
          g.cardIds.length,
        ]
        if (withCoding) row.push(codeName(g.name, nameMarkers))
        rows.push(row)
      }
    }
  }
  return csvFile(meta(sessions), header, rows)
}

/**
 * Groups per submission as JSON, nested by session.
 *
 * @param {ExportSession[]} sessions Sessions to export.
 * @returns {object} JSON export with provenance fields and `sessions[].submissions[]`.
 */
export function groupsJson(sessions: ExportSession[]) {
  return {
    exportedAt: new Date().toISOString(),
    cardSetVersion: CARD_SET_VERSION,
    submissionCount: meta(sessions).submissions,
    sessions: sessions.map(({ sessionKey, analysis }) => ({
      sessionKey,
      submissions: analysis.submissions.map((sub) => ({
        participantNo: sub.participantNo,
        studentId: sub.studentId,
        lang: sub.lang ?? 'de',
        ...sub.groups,
      })),
    })),
  }
}
