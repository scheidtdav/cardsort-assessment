import { useState } from 'react'
import type { SubmissionAnalysis } from '@sortiertool/shared/analysis'
import type { Schema } from '../../lib/types'
import { useLang } from '../../lib/i18n'
import { formatDateTimeShort, formatNumber, formatPercent, formatPoints } from '../../lib/format'

/** Sortable column: `'no' | 'time' | 'groups' | 'lead' | `score:${schema}` | `ari:${schema}``. */
type SortKey = string
/** Toggleable column: like {@link SortKey} without `'no'`, plus `'best' | 'lang'`. */
type ColKey = string

/**
 * Sortable table of all submissions with a column picker; a row click opens the submission.
 *
 * The teacher view starts with a reduced column set, the research view with all columns
 * (including ARI and language).
 *
 * @param {object} props Component props.
 * @param {SubmissionAnalysis[]} props.submissions Analyzed submissions.
 * @param {Schema[]} props.schemas Usable reference schemas.
 * @param {Schema | undefined} props.deep Deep-structure schema, if usable.
 * @param {boolean} props.research Research view: offers ARI and language columns.
 * @param {(participantNo: number) => void} props.onOpen Opens a single submission.
 * @returns {JSX.Element} Column picker and table.
 */
export function SubmissionTable({
  submissions,
  schemas,
  deep,
  research,
  onOpen,
}: {
  submissions: SubmissionAnalysis[]
  schemas: Schema[]
  deep: Schema | undefined
  research: boolean
  onOpen: (participantNo: number) => void
}) {
  const { lang, t } = useLang()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'no', dir: 1 })

  /**
   * Localized label of a schema.
   *
   * @param {string} key Schema key.
   * @returns {string} Label, or the key if the schema is unknown.
   */
  const label = (key: string) => schemas.find((s) => s.key === key)?.label[lang] ?? key
  const columns: { key: ColKey; label: string }[] = [
    { key: 'time', label: t.ana.subs.col.time },
    { key: 'groups', label: t.ana.subs.col.groups },
    { key: 'studentId', label: t.ana.subs.col.studentId },
    ...schemas.map((s) => ({ key: `score:${s.key}`, label: s.label[lang] })),
    ...(research ? schemas.map((s) => ({ key: `ari:${s.key}`, label: t.ana.subs.ari(s.label[lang]) })) : []),
    { key: 'best', label: t.ana.subs.col.best },
    ...(deep ? [{ key: 'lead', label: t.ana.subs.col.lead }] : []),
    ...(research ? [{ key: 'lang', label: t.ana.subs.col.lang }] : []),
  ]
  const [visible, setVisible] = useState<Set<ColKey>>(
    () =>
      new Set(
        research
          ? columns.map((c) => c.key)
          : deep
            ? ['groups', 'studentId', `score:${deep.key}`, 'best', 'lead']
            : ['groups', 'studentId', ...schemas.map((s) => `score:${s.key}`), 'best'],
      ),
  )
  /**
   * Whether a column is currently shown.
   *
   * @param {ColKey} key Column key.
   * @returns {boolean} `true` if visible.
   */
  const on = (key: ColKey) => visible.has(key)
  /**
   * Shows or hides a column; hiding the sort column falls back to sorting by number.
   *
   * @param {ColKey} key Column key.
   * @returns {void}
   */
  const toggle = (key: ColKey) => {
    const next = new Set(visible)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setVisible(next)
    if (!next.has(sort.key) && sort.key !== 'no') setSort({ key: 'no', dir: 1 })
  }

  /**
   * Sort value of a submission for a column.
   *
   * @param {SubmissionAnalysis} s Submission.
   * @param {SortKey} key Sort column.
   * @returns {number | string} Comparable value; a missing lead counts as `-Infinity`
   *   (last when sorted descending).
   */
  const value = (s: SubmissionAnalysis, key: SortKey): number | string => {
    if (key === 'no') return s.participantNo
    if (key === 'time') return s.createdAt
    if (key === 'groups') return s.groupCount
    if (key === 'studentId') return s.studentId ?? ''
    if (key === 'lead') return s.deepStructureLead ?? -Infinity
    const [kind, schema] = key.split(':')
    const r = s.schemas[schema]
    return kind === 'ari' ? r.ari : r.score
  }
  const rows = [...submissions].sort((a, b) => {
    const va = value(a, sort.key)
    const vb = value(b, sort.key)
    return (va < vb ? -1 : va > vb ? 1 : a.participantNo - b.participantNo) * sort.dir
  })

  /**
   * Sortable column header that toggles the sort direction on repeated clicks.
   *
   * @param {SortKey} key Sort column.
   * @param {string} label Header text.
   * @param {boolean} [num=false] Right-aligned numeric column.
   * @returns {JSX.Element} The header cell.
   */
  const header = (key: SortKey, label: string, num = false) => (
    <th
      key={key}
      className={num ? 'num' : undefined}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="th-sort"
        onClick={() =>
          // First click on a metric sorts descending (highest values on top).
          setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'no' || key === 'time' ? 1 : -1 }))
        }
      >
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  )

  return (
    <>
      <div className="segmented colpicker" role="group" aria-label={t.ana.subs.columns}>
        <span className="segmented__label">{t.ana.subs.columns}</span>
        {columns.map((c) => (
          <button
            key={c.key}
            type="button"
            className={on(c.key) ? 'is-active' : ''}
            aria-pressed={on(c.key)}
            onClick={() => toggle(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="table table--analysis">
          <thead>
            <tr>
              {header('no', t.ana.subs.col.no)}
              {on('time') && header('time', t.ana.subs.col.time)}
              {on('groups') && header('groups', t.ana.subs.col.groups, true)}
              {on('studentId') && <th>{t.ana.subs.col.studentId}</th>}
              {schemas.map((s) => on(`score:${s.key}`) && header(`score:${s.key}`, s.label[lang], true))}
              {schemas.map((s) => on(`ari:${s.key}`) && header(`ari:${s.key}`, t.ana.subs.ari(s.label[lang]), true))}
              {on('best') && <th>{t.ana.subs.col.best}</th>}
              {on('lead') && header('lead', t.ana.subs.col.lead, true)}
              {on('lang') && <th>{t.ana.subs.col.lang}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.participantNo} className="row--link" onClick={() => onOpen(s.participantNo)}>
                <td>
                  <button
                    type="button"
                    className="linkbtn"
                    aria-label={t.ana.subs.detailTitle(s.participantNo)}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(s.participantNo)
                    }}
                  >
                    {s.participantNo}
                  </button>
                </td>
                {on('time') && <td>{formatDateTimeShort(s.createdAt, lang)}</td>}
                {on('groups') && <td className="num">{s.groupCount}</td>}
                {on('studentId') && <td>{s.studentId ?? ''}</td>}
                {schemas.map(
                  (sc) =>
                    on(`score:${sc.key}`) && (
                      <td key={sc.key} className="num">
                        {formatPercent(s.schemas[sc.key].score, lang)}
                      </td>
                    ),
                )}
                {schemas.map(
                  (sc) =>
                    on(`ari:${sc.key}`) && (
                      <td key={`ari-${sc.key}`} className="num">
                        {formatNumber(s.schemas[sc.key].ari, lang, 3)}
                      </td>
                    ),
                )}
                {on('best') && <td>{s.bestSchemas.map(label).join(' / ') || t.ana.none}</td>}
                {on('lead') && (
                  <td className="num">
                    {s.deepStructureLead === null ? t.ana.none : formatPoints(s.deepStructureLead, lang)}
                  </td>
                )}
                {on('lang') && <td>{s.lang ?? 'de'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
