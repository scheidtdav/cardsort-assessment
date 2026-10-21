import { useState } from 'react'
import type { FormEvent } from 'react'
import '../ui.css'
import { QrCode } from '../components/QrCode'
import { createSession, ApiError } from '../lib/api'
import type { CreatedSession } from '../lib/api'

/**
 * Labeled read-only URL field with a copy button.
 *
 * @param {object} props Component props.
 * @param {string} props.label Label shown before the field.
 * @param {string} props.url URL to show and copy.
 * @returns {JSX.Element} Link row.
 */
function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="linkrow">
      <span className="linkrow__label">{label}</span>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={() => void navigator.clipboard?.writeText(url)}>
        Kopieren
      </button>
    </div>
  )
}

/**
 * Form for creating a session (teacher), optionally with a self-chosen admin key; after creation
 * it shows session key, admin key, student link with QR code and admin link.
 *
 * @returns {JSX.Element} Creation form, or the result page once created.
 */
export function TeacherView() {
  const [klassenstufe, setKlassenstufe] = useState('')
  const [schulform, setSchulform] = useState('')
  const [mlVorwissen, setMlVorwissen] = useState('')
  const [bundesland, setBundesland] = useState('')
  const [note, setNote] = useState('')
  const [eigenerKey, setEigenerKey] = useState(false)
  const [adminKey, setAdminKey] = useState('')
  const [requiresStudentId, setRequiresStudentId] = useState(false)
  const [result, setResult] = useState<CreatedSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /**
   * Creates the session and maps API errors to messages (409 = admin key taken, 400 = invalid
   * admin key).
   *
   * @param {FormEvent} e Form submit event.
   * @returns {Promise<void>}
   */
  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const created = await createSession({
        klassenstufe,
        schulform,
        mlVorwissen,
        bundesland: bundesland || undefined,
        note: note || undefined,
        adminKey: (eigenerKey && adminKey.trim()) || undefined,
        requiresStudentId,
      })
      setResult(created)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Dieser Verwaltungsschlüssel ist schon vergeben. Bitte einen anderen wählen.')
      } else if (err instanceof ApiError && err.status === 400) {
        setError('Verwaltungsschlüssel ungültig: 8–24 Zeichen, nur Buchstaben und Ziffern.')
      } else {
        setError('Anlegen fehlgeschlagen. Läuft der Server (Port 3001)?')
      }
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    const base = window.location.origin
    const joinUrl = `${base}/?session=${encodeURIComponent(result.sessionKey)}`
    const adminUrl = `${base}/?admin=${encodeURIComponent(result.adminKey)}`
    return (
      <div className="page">
        <p className="links">
          <a href="/">← zur Sortieransicht</a>
        </p>
        <h1>Sitzung angelegt</h1>
        <p>
          Sitzungs-Schlüssel (für Schüler:innen):{' '}
          <strong className="big-key">{result.sessionKey}</strong>
        </p>
        <p>
          Verwaltungsschlüssel (geheim halten!):{' '}
          <strong className="big-key">{result.adminKey}</strong>
        </p>
        <LinkRow label="Link für Schüler:innen" url={joinUrl} />
        {/* Same link for scanning, for tablets other than the presenting device. */}
        <QrCode value={joinUrl} />
        <LinkRow label="Verwaltungslink (geheim halten!)" url={adminUrl} />
        <p className="muted">
          Teile den Schüler-Link oder den Sitzungs-Schlüssel. Mit dem Verwaltungsschlüssel
          kommst du jederzeit über „Sitzung verwalten" zurück auf diese Sitzung — notiere
          ihn dir.
        </p>
        <p className="links">
          <a href={joinUrl}>→ Sortier-Ansicht öffnen</a>
          {' · '}
          <a href={adminUrl}>→ Verwaltung öffnen</a>
        </p>
        <button type="button" onClick={() => setResult(null)}>
          Weitere Sitzung anlegen
        </button>
      </div>
    )
  }

  return (
    <div className="page">
      <p className="links">
        <a href="/">← zur Sortieransicht</a>
      </p>
      <h1>ML-Sortiertool</h1>
      <h2>Sitzung anlegen (Lehrkraft)</h2>
      <form className="form" onSubmit={handleCreate}>
        <label>
          Klassenstufe
          <input
            required
            value={klassenstufe}
            onChange={(e) => setKlassenstufe(e.target.value)}
          />
        </label>
        <label>
          Schulform
          <input
            required
            value={schulform}
            onChange={(e) => setSchulform(e.target.value)}
          />
        </label>
        <label>
          ML-Vorwissen (Unterrichtseinheiten)
          <input
            required
            value={mlVorwissen}
            onChange={(e) => setMlVorwissen(e.target.value)}
          />
        </label>
        <label>
          Bundesland (optional)
          <input value={bundesland} onChange={(e) => setBundesland(e.target.value)} />
        </label>
        <label>
          Notiz (optional, keine personenbezogenen Daten)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={eigenerKey}
            onChange={(e) => setEigenerKey(e.target.checked)}
          />
          Verwaltungsschlüssel selbst wählen (sonst erzeugt der Server einen sicheren)
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={requiresStudentId}
            onChange={(e) => setRequiresStudentId(e.target.checked)}
          />
          Schüler:innen-ID/Pseudonym erforderlich (für individuelle Auswertung)
        </label>
        {eigenerKey && (
          <label>
            Verwaltungsschlüssel
            <input
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value.toUpperCase())}
              placeholder="mind. 8 Zeichen — leer = zufällig erzeugt"
              pattern="[A-Za-z0-9]{8,24}"
              title="8–24 Zeichen, nur Buchstaben und Ziffern"
              aria-label="Verwaltungsschlüssel"
            />
            <span className="muted">
              Damit öffnest du später die Verwaltung dieser Sitzung. 8–24 Buchstaben/Ziffern,
              nicht erratbar wählen — wer ihn kennt, sieht alle Daten der Klasse.
            </span>
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Anlegen…' : 'Sitzung anlegen'}
        </button>
      </form>
    </div>
  )
}
