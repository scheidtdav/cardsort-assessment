/**
 * Shared, serializable data model of client and server: card set, reference schemas and the
 * sort state of a submission.
 */

/** Supported UI and card-text languages. */
export type Lang = 'de' | 'en'

/** Text in every supported language. */
export type Localized = Record<Lang, string>

/** Schema key → category key of a card (both from `schemas.json`). */
export type CardFeatures = Record<string, string>

/**
 * One card as stored in `cards.json`, with texts in all languages.
 *
 * `short` and `features` are only used by the analysis; without `features` a schema drops out via
 * `usableSchemas` (analysis.ts), without `short` labels fall back to the id.
 *
 * @property {string} id Stable card id.
 * @property {Localized} [short] Short name for chart axes.
 * @property {string} image URL path of the image, e.g. `/cards/spam.jpg`.
 * @property {Localized} text Card text.
 * @property {CardFeatures} [features] Category of the card per reference schema.
 */
export interface CardSource {
  id: string
  short?: Localized
  image: string
  text: Localized
  features?: CardFeatures
}

/** Whether a schema captures the conceptual (deep) or the surface structure of the cards. */
export type SchemaRole = 'tiefenstruktur' | 'oberflaeche'

/**
 * One category of a reference schema.
 *
 * @property {string} key Category key, referenced by `CardSource.features`.
 * @property {Localized} label Display name.
 * @property {string} color Fixed display color.
 */
export interface SchemaCategory {
  key: string
  label: Localized
  color: string
}

/**
 * Reference schema of the analysis: a reference partition of the cards. Which card belongs to
 * which category is stored in `CardSource.features`, not here.
 *
 * @property {string} key Schema key.
 * @property {SchemaRole} role Deep or surface structure.
 * @property {Localized} label Display name.
 * @property {SchemaCategory[]} categories Categories in display order.
 */
export interface Schema {
  key: string
  role: SchemaRole
  label: Localized
  categories: SchemaCategory[]
}

/**
 * One type of group name for the automatic pre-coding of group names.
 *
 * @property {string} key Type key.
 * @property {Localized} label Display name.
 * @property {string} color Display color.
 * @property {string[]} stems Lowercase word beginnings that mark this type.
 */
export interface NameType {
  key: string
  label: Localized
  color: string
  stems: string[]
}

/**
 * Marker word list from `name-markers.json`.
 *
 * @property {NameType[]} types Name types with their marker stems.
 */
export interface NameMarkers {
  types: NameType[]
}

/**
 * {@link CardSource} resolved to one language.
 *
 * @property {string} id Card id.
 * @property {string} image Image path.
 * @property {string} text Card text in the active language.
 */
export interface Card {
  id: string
  image: string
  text: string
}

/**
 * Rectangle in world coordinates.
 *
 * @property {number} x Left edge.
 * @property {number} y Top edge.
 * @property {number} width Width.
 * @property {number} height Height.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Size of the work surface the coordinates refer to.
 *
 * @property {number} width Width.
 * @property {number} height Height.
 */
export interface CanvasSize {
  width: number
  height: number
}

/**
 * Group frame drawn on the canvas; position and size from {@link Rect}.
 *
 * @property {string} id Group id.
 * @property {string} name Name given by the learner (may be empty while sorting).
 * @property {string} color Frame color, also used as card border.
 */
export interface Group extends Rect {
  id: string
  name: string
  color: string
}

/**
 * Position and group assignment of one card.
 *
 * @property {string} cardId Card id.
 * @property {boolean} onCanvas `false` while the card is still in the stack.
 * @property {number} x Left edge in world coordinates.
 * @property {number} y Top edge in world coordinates.
 * @property {string | null} groupId Group the card lies in; `null` = ungrouped (grey).
 */
export interface CardPlacement {
  cardId: string
  onCanvas: boolean
  x: number
  y: number
  groupId: string | null
}

/**
 * Complete sort state of a learner — the payload of a submission.
 *
 * Coordinates are world coordinates while sorting, but fractions `0..1` of `canvas` in the
 * PERSISTED submission (client/src/lib/relative.ts).
 *
 * @property {CardPlacement[]} placements One placement per card.
 * @property {Group[]} groups Group frames.
 * @property {CanvasSize} canvas Size of the work surface.
 * @property {Lang} [lang] Language sorted in; missing in old submissions = German.
 * @property {string} [studentId] Optional student identifier/pseudonym.
 */
export interface SortState {
  placements: CardPlacement[]
  groups: Group[]
  canvas: CanvasSize
  lang?: Lang
  studentId?: string
}
