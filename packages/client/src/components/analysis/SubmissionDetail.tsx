import { useEffect, useRef } from 'react'
import type { SubmissionAnalysis } from '@sortiertool/shared/analysis'
import type { CardSource, Schema } from '../../lib/types'
import { useLang } from '../../lib/i18n'
import { NEUTRAL_BAR, categoryOf } from '../../lib/chart'
import { BarList } from './BarList'

/**
 * Modal overlay of a single submission: its groups as card thumbnails (plus ungrouped and
 * unplaced cards) and its scores; closes on backdrop click or Escape.
 *
 * @param {object} props Component props.
 * @param {SubmissionAnalysis} props.submission Submission to show.
 * @param {CardSource[]} props.cards Card set of the session.
 * @param {Schema[]} props.schemas Usable reference schemas.
 * @param {Schema | null} props.colorSchema Schema whose category colors mark the cards, or
 *   `null`.
 * @param {() => void} props.onClose Closes the overlay.
 * @returns {JSX.Element} The overlay.
 */
export function SubmissionDetail({
  submission,
  cards,
  schemas,
  colorSchema,
  onClose,
}: {
  submission: SubmissionAnalysis
  cards: CardSource[]
  schemas: Schema[]
  colorSchema: Schema | null
  onClose: () => void
}) {
  const { lang, t } = useLang()
  const closeRef = useRef<HTMLButtonElement>(null)
  const byId = new Map(cards.map((c) => [c.id, c]))
  const deep = schemas.find((s) => s.role === 'tiefenstruktur')

  // Focus moves into the dialog; Escape closes it.
  useEffect(() => {
    closeRef.current?.focus()
    /**
     * Closes the overlay on Escape.
     *
     * @param {KeyboardEvent} e Keyboard event.
     * @returns {void}
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * Thumbnail of a card with its id, short name and category swatch.
   *
   * @param {string} id Card id.
   * @returns {JSX.Element} The thumbnail figure.
   */
  const cardThumb = (id: string) => {
    const card = byId.get(id)
    const cat = card && colorSchema ? categoryOf(card, colorSchema) : undefined
    return (
      <figure className="thumb" key={id} title={card?.short?.[lang]}>
        {card && <img src={card.image} alt="" />}
        <figcaption>
          {cat && <span className="swatch" style={{ background: cat.color }} aria-hidden="true" />}
          {id} {card?.short?.[lang]}
        </figcaption>
      </figure>
    )
  }
  const extra = [
    { label: t.ana.subs.ungrouped, ids: submission.groups.ungrouped },
    { label: t.ana.subs.notPlaced, ids: submission.groups.notPlaced },
  ].filter((x) => x.ids.length > 0)

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-label={t.ana.subs.detailTitle(submission.participantNo)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overlay__head">
          <h2>{t.ana.subs.detailTitle(submission.participantNo)}</h2>
          <button type="button" className="ghost" ref={closeRef} onClick={onClose}>
            {t.ana.subs.close}
          </button>
        </div>
        {submission.studentId && (
          <p className="muted">
            {t.ana.subs.col.studentId}: <strong>{submission.studentId}</strong>
          </p>
        )}

        <h3>{t.ana.subs.sorting}</h3>
        {colorSchema && <p className="muted">{t.ana.subs.colorNote(colorSchema.label[lang])}</p>}
        <div className="groupboxes">
          {submission.groups.groups
            .filter((g) => g.cardIds.length > 0)
            .map((g, i) => (
              <section className="groupbox" key={i}>
                <h4>{g.name.trim() || t.ana.subs.unnamed}</h4>
                <div className="groupbox__cards">{g.cardIds.map(cardThumb)}</div>
              </section>
            ))}
          {extra.map((x) => (
            <section className="groupbox groupbox--loose" key={x.label}>
              <h4>{x.label}</h4>
              <div className="groupbox__cards">{x.ids.map(cardThumb)}</div>
            </section>
          ))}
        </div>

        {schemas.length > 0 && (
          <>
            <h3>{t.ana.scoreTitle}</h3>
            <BarList
              chance
              swatches={false}
              items={schemas.map((s) => ({
                key: s.key,
                label: t.ana.scoreLabel(s.label[lang]),
                value: submission.schemas[s.key].score,
                color: NEUTRAL_BAR,
              }))}
            />
          </>
        )}
        {deep && (
          <>
            <h3>{t.ana.categoryTitle(deep.label[lang])}</h3>
            <BarList
              items={deep.categories.map((c, k) => ({
                key: c.key,
                label: c.label[lang],
                value: submission.schemas[deep.key].categoryHitRates[k],
                color: c.color,
                note: t.ana.categorySingle,
              }))}
            />
          </>
        )}
      </div>
    </div>
  )
}
