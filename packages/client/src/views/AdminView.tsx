import { useCallback, useEffect, useState } from 'react'
import '../ui.css'
import {
  getAdmin,
  getAnalysis,
  closeSession,
  reopenSession,
  deleteSession,
  exportCsvUrl,
  exportJsonUrl,
  updateSessionSettings,
} from '../lib/api'
import type { AdminOverview, AnalysisData } from '../lib/api'
import { useLang } from '../lib/i18n'
import { formatDateTime } from '../lib/format'
import { LangSwitch } from '../components/LangSwitch'
import { AnalysisDashboard } from '../components/analysis/AnalysisDashboard'

/**
 * Teacher administration of a single session, accessed via the admin key: status, close/reopen,
 * delete, exports and either the submission list (while running) or, once closed, the
 * {@link AnalysisDashboard}.
 *
 * @param {object} props Component props.
 * @param {string} props.adminKey Admin key from `?admin=`.
 * @returns {JSX.Element} Admin page, or a loading/error/deleted state.
 */
export function AdminView({ adminKey }: { adminKey: string }) {
  const { lang, t } = useLang()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [error, setError] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)

  /**
   * Reloads the overview and, for a closed session, the analysis.
   *
   * @returns {Promise<void>}
   */
  const refresh = useCallback(async () => {
    const d = await getAdmin(adminKey)
    setData(d)
    setAnalysis(d.session.closedAt ? await getAnalysis(adminKey) : null)
  }, [adminKey])

  useEffect(() => {
    let active = true
    getAdmin(adminKey)
      .then(async (d) => {
        if (!active) return
        setData(d)
        if (d.session.closedAt) {
          const a = await getAnalysis(adminKey)
          if (active) setAnalysis(a)
        }
      })
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [adminKey])

  const header = (
    <div className="pagehead">
      <p className="links">
        <a href="/">{t.dash.back}</a>
      </p>
      <LangSwitch />
    </div>
  )

  if (deleted) {
    return (
      <div className="page">
        {header}
        <h1>{t.admin.deletedTitle}</h1>
        <p className="muted">{t.admin.deletedText}</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="page">
        {header}
        <h1>{t.admin.heading}</h1>
        <p className="error">{t.admin.notFound}</p>
        <p className="links">
          <a href="?verwalten">{t.admin.otherKey}</a>
        </p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="page">
        <p>{t.dash.loading}</p>
      </div>
    )
  }

  const s = data.session
  const isClosed = s.closedAt !== null

  /**
   * Closes the session for submissions after confirmation, which unlocks the analysis.
   *
   * @returns {Promise<void>}
   */
  async function onClose() {
    if (!confirm(t.admin.confirmClose)) return
    setBusy(true)
    try {
      await closeSession(adminKey)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Reopens the session for submissions.
   *
   * @returns {Promise<void>}
   */
  async function onReopen() {
    setBusy(true)
    try {
      await reopenSession(adminKey)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Toggles the requiresStudentId setting for the session.
   *
   * @returns {Promise<void>}
   */
  async function onToggleRequiresStudentId() {
    if (!data) return
    setSettingsBusy(true)
    try {
      const newSetting = !data.session.requiresStudentId
      await updateSessionSettings(adminKey, { requiresStudentId: newSetting })
      await refresh()
    } finally {
      setSettingsBusy(false)
    }
  }

  /**
   * Deletes the session with all submissions after confirmation.
   *
   * @returns {Promise<void>}
   */
  async function onDelete() {
    if (!confirm(t.admin.confirmDelete)) return
    await deleteSession(adminKey)
    setDeleted(true)
  }

  return (
    <div className={`page${isClosed ? ' page--wide' : ''}`}>
      {header}
      <h1>{t.admin.title(s.sessionKey)}</h1>
      <p>
        {t.admin.status}:{' '}
        <strong>
          {isClosed ? t.admin.closedAt(formatDateTime(s.closedAt as string, lang)) : t.admin.running}
        </strong>{' '}
        · {t.admin.submissions}: <strong>{data.submissionCount}</strong>
        {data.excludedCount > 0 && (
          <span className="muted"> · {t.admin.excluded(data.excludedCount)}</span>
        )}
      </p>
      <p className="muted">{t.admin.keyHint(<code>{s.adminKey}</code>)}</p>
      <p className="muted">
        {t.admin.classInfo(s)} · {t.admin.cardSet(s.cardSetVersion)}
      </p>

      <div className="actions">
        {isClosed ? (
          <button type="button" disabled={busy} onClick={() => void onReopen()}>
            {t.admin.reopen}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void onClose()}>
            {t.admin.close}
          </button>
        )}
        <button type="button" className="ghost" onClick={() => void refresh()}>
          {t.dash.refresh}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={settingsBusy}
          onClick={() => void onToggleRequiresStudentId()}
        >
          {s.requiresStudentId ? 'Schüler:innen-ID deaktivieren' : 'Schüler:innen-ID aktivieren'}
        </button>
        <button type="button" className="danger" onClick={() => void onDelete()}>
          {t.admin.remove}
        </button>
      </div>
      <div className="actions" role="group" aria-label={t.admin.exportsLabel}>
        <a className="btn ghost" href={exportCsvUrl(adminKey, 'metrics')}>
          {t.admin.csvMetrics}
        </a>
        <a className="btn ghost" href={exportCsvUrl(adminKey, 'names')}>
          {t.admin.csvNames}
        </a>
        <a className="btn ghost" href={exportCsvUrl(adminKey, 'matrix')}>
          {t.admin.csvMatrix}
        </a>
        <a className="btn ghost" href={exportJsonUrl(adminKey, 'groups')}>
          {t.admin.jsonGroups}
        </a>
        <a className="btn ghost" href={exportJsonUrl(adminKey, 'raw')}>
          {t.admin.jsonRaw}
        </a>
      </div>

      {isClosed && analysis ? (
        <section className="analysis">
          <h2>{t.admin.analysisTitle}</h2>
          {s.cardSetOutdated && <p className="notice notice--warn">{t.admin.cardSetOutdated}</p>}
          <AnalysisDashboard
            cards={analysis.cards}
            schemas={analysis.schemas}
            analysis={analysis.analysis}
          />
        </section>
      ) : (
        <>
          <h2>{t.admin.submissionsTitle(data.submissionCount)}</h2>
          {data.submissions.length === 0 ? (
            <p className="muted">{t.admin.noSubmissions}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.ana.subs.col.no}</th>
                    <th>{t.admin.colCreated}</th>
                    <th>{t.admin.colUpdated}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.submissions.map((r) => (
                    <tr key={r.participantNo}>
                      <td>{r.participantNo}</td>
                      <td>{formatDateTime(r.createdAt, lang)}</td>
                      <td>{formatDateTime(r.updatedAt, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isClosed && <p className="muted">{t.admin.analysisLater}</p>}
        </>
      )}
    </div>
  )
}
