import type {
  CardFeatures,
  CardPlacement,
  Lang,
  NameMarkers,
  Schema,
  SortState,
} from './types'
import { buildAggregateMatrix } from './cooccurrence'

/**
 * Analysis of the dashboard and the exports, shared by client and server.
 *
 * A sorting is a PARTITION of the cards. Every metric compares it pairwise with a reference
 * partition (a schema from schemas.json) or with the other submissions of the session
 * (co-occurrence). All shares are numbers from 0 to 1; percent and rounding are up to display
 * and export.
 */

/**
 * Card as needed by the analysis.
 *
 * @property {string} id Card id.
 * @property {CardFeatures} [features] Category per reference schema.
 */
type CardRef = { id: string; features?: CardFeatures }

// --- Partitions --------------------------------------------------------------------------

/**
 * Partition of a sorting as one label per card: same label = same group.
 *
 * Ungrouped (`groupId: null`), never placed (`onCanvas: false`) and missing cards each get an
 * own label, i.e. count as singleton groups — like `sameGroup` in cooccurrence.ts.
 *
 * @param {string[]} cardIds Cards in canonical order; index = position in the result.
 * @param {CardPlacement[]} placements Placements of the submission.
 * @returns {number[]} Group label per card.
 */
export function partitionOf(cardIds: string[], placements: CardPlacement[]): number[] {
  const byCard = new Map(placements.map((p) => [p.cardId, p]))
  const labelOfGroup = new Map<string, number>()
  let next = 0
  return cardIds.map((id) => {
    const p = byCard.get(id)
    if (!p || !p.onCanvas || p.groupId === null) return next++
    let label = labelOfGroup.get(p.groupId)
    if (label === undefined) {
      label = next++
      labelOfGroup.set(p.groupId, label)
    }
    return label
  })
}

/**
 * Reference partition of a schema: label = index of the card's category in
 * `schema.categories`.
 *
 * @param {CardRef[]} cards Cards in canonical order.
 * @param {Schema} schema Reference schema.
 * @returns {number[] | null} Label per card, or `null` as soon as one card lacks a valid value.
 */
export function referencePartition(cards: CardRef[], schema: Schema): number[] | null {
  const index = new Map(schema.categories.map((c, i) => [c.key, i]))
  const labels: number[] = []
  for (const card of cards) {
    const i = index.get(card.features?.[schema.key] ?? '')
    if (i === undefined) return null
    labels.push(i)
  }
  return labels
}

/**
 * Counts the card pairs that belong together and apart according to a reference.
 *
 * @param {number[]} reference Reference partition.
 * @returns {{ together: number; apart: number }} Number of same-label and different-label pairs.
 */
function pairCounts(reference: number[]): { together: number; apart: number } {
  let together = 0
  let apart = 0
  for (let i = 0; i < reference.length; i++) {
    for (let j = i + 1; j < reference.length; j++) {
      if (reference[i] === reference[j]) together++
      else apart++
    }
  }
  return { together, apart }
}

/**
 * Filters the schemas the analysis can use: every card has a valid value, and there are both
 * pairs together and pairs apart (otherwise hit or separation rate would be undefined).
 *
 * @param {CardRef[]} cards Cards in canonical order.
 * @param {Schema[]} schemas All reference schemas.
 * @returns {Schema[]} Usable schemas, in input order.
 */
export function usableSchemas(cards: CardRef[], schemas: Schema[]): Schema[] {
  return schemas.filter((s) => {
    const ref = referencePartition(cards, s)
    if (!ref) return false
    const { together, apart } = pairCounts(ref)
    return together > 0 && apart > 0
  })
}

// --- Metrics per submission --------------------------------------------------------------

/**
 * Agreement of a sorting with a reference over all card pairs.
 *
 * `score` = 0.5 is chance level regardless of the group count (everything in one group or
 * everything separate yields exactly 0.5), 1 = identical to the reference.
 *
 * @property {number} hitRate Share of pairs together in the reference that lie together.
 * @property {number} separationRate Share of pairs apart in the reference that lie apart.
 * @property {number} score Mean of both rates.
 */
export interface PairAgreement {
  hitRate: number
  separationRate: number
  score: number
}

/**
 * Computes the {@link PairAgreement} of a sorting. Requires a usable schema
 * ({@link usableSchemas}), otherwise the rates divide by zero.
 *
 * @param {number[]} partition Partition of the sorting.
 * @param {number[]} reference Reference partition.
 * @returns {PairAgreement} Hit rate, separation rate and score.
 */
export function pairAgreement(partition: number[], reference: number[]): PairAgreement {
  const { together, apart } = pairCounts(reference)
  let hits = 0
  let separations = 0
  for (let i = 0; i < reference.length; i++) {
    for (let j = i + 1; j < reference.length; j++) {
      const same = partition[i] === partition[j]
      if (reference[i] === reference[j]) {
        if (same) hits++
      } else if (!same) separations++
    }
  }
  const hitRate = hits / together
  const separationRate = separations / apart
  return { hitRate, separationRate, score: (hitRate + separationRate) / 2 }
}

/**
 * Hit rate per category: share of the category's internal card pairs that lie together.
 *
 * @param {number[]} partition Partition of the sorting.
 * @param {number[]} reference Reference partition.
 * @param {number} categoryCount Number of categories of the schema.
 * @returns {(number | null)[]} Rate per category (index as in `schema.categories`); `null` for
 *   categories with fewer than two cards.
 */
export function categoryHitRates(
  partition: number[],
  reference: number[],
  categoryCount: number,
): (number | null)[] {
  const pairs = new Array<number>(categoryCount).fill(0)
  const hits = new Array<number>(categoryCount).fill(0)
  for (let i = 0; i < reference.length; i++) {
    for (let j = i + 1; j < reference.length; j++) {
      if (reference[i] !== reference[j]) continue
      pairs[reference[i]]++
      if (partition[i] === partition[j]) hits[reference[i]]++
    }
  }
  return pairs.map((n, k) => (n === 0 ? null : hits[k] / n))
}

/**
 * Number of unordered pairs among `n` elements.
 *
 * @param {number} n Element count.
 * @returns {number} `n · (n − 1) / 2`.
 */
const choose2 = (n: number) => (n * (n - 1)) / 2

/**
 * Adjusted Rand Index of two partitions (Hubert & Arabie 1985).
 *
 * If both partitions are equally trivial (everything in one group, or everything separate),
 * the denominator is 0 — agreement then counts as complete.
 *
 * @param {number[]} a First partition.
 * @param {number[]} b Second partition.
 * @returns {number} 0 = chance level, 1 = identical.
 */
export function adjustedRandIndex(a: number[], b: number[]): number {
  const cells = new Map<string, number>()
  const rows = new Map<number, number>()
  const cols = new Map<number, number>()
  for (let i = 0; i < a.length; i++) {
    const key = `${a[i]}|${b[i]}`
    cells.set(key, (cells.get(key) ?? 0) + 1)
    rows.set(a[i], (rows.get(a[i]) ?? 0) + 1)
    cols.set(b[i], (cols.get(b[i]) ?? 0) + 1)
  }
  let index = 0
  for (const n of cells.values()) index += choose2(n)
  let sumA = 0
  for (const n of rows.values()) sumA += choose2(n)
  let sumB = 0
  for (const n of cols.values()) sumB += choose2(n)
  const expected = (sumA * sumB) / choose2(a.length)
  const max = (sumA + sumB) / 2
  if (max === expected) return 1
  return (index - expected) / (max - expected)
}

/** Tie tolerance for floating-point score comparisons. */
const EPS = 1e-9

/**
 * Schemas with the highest score.
 *
 * @param {Record<string, number>} scores Score per schema key.
 * @returns {string[]} Keys of the best schemas; all of them on a tie.
 */
export function bestSchemas(scores: Record<string, number>): string[] {
  const entries = Object.entries(scores)
  if (entries.length === 0) return []
  const max = Math.max(...entries.map(([, s]) => s))
  return entries.filter(([, s]) => s >= max - EPS).map(([key]) => key)
}

/**
 * Net lead of the deep structure: score of the (first) deep-structure schema minus the highest
 * score of the surface schemas.
 *
 * @param {Record<string, number>} scores Score per usable schema key.
 * @param {Schema[]} schemas Schemas, used for their role.
 * @returns {number | null} Positive = closer to the deep structure; `null` if either side has
 *   no usable schema.
 */
export function deepStructureLead(
  scores: Record<string, number>,
  schemas: Schema[],
): number | null {
  const deep = schemas.find((s) => s.role === 'tiefenstruktur' && s.key in scores)
  const surface = schemas
    .filter((s) => s.role === 'oberflaeche' && s.key in scores)
    .map((s) => scores[s.key])
  if (!deep || surface.length === 0) return null
  return scores[deep.key] - Math.max(...surface)
}

// --- Co-occurrence and clustering --------------------------------------------------------

/**
 * Converts the aggregate matrix from counts into shares of submissions.
 *
 * @param {number[][]} matrix Aggregate matrix ({@link buildAggregateMatrix}).
 * @param {number} submissionCount Number of submissions aggregated.
 * @returns {number[][]} Share of submissions in which each pair lies together; `0` without
 *   submissions.
 */
export function cooccurrenceShares(matrix: number[][], submissionCount: number): number[][] {
  return matrix.map((row) => row.map((v) => (submissionCount > 0 ? v / submissionCount : 0)))
}

/**
 * One merge step of {@link hac}. Node ids: `0..n−1` are the cards (leaves), `n + k` is the
 * cluster created in step `k`.
 *
 * @property {number} a Node id of the first merged node.
 * @property {number} b Node id of the second merged node.
 * @property {number} distance Linkage distance at the merge (dendrogram height).
 * @property {number} size Number of cards in the new cluster.
 */
export interface Merge {
  a: number
  b: number
  distance: number
  size: number
}

/**
 * Hierarchical agglomerative clustering with average linkage down to a single cluster.
 *
 * On equal distances the first pair in iteration order wins — dendrogram and heatmap order rely
 * on this determinism.
 *
 * @param {number[][]} distance Symmetric card×card distance matrix.
 * @returns {Merge[]} `n − 1` merge steps in merge order.
 */
export function hac(distance: number[][]): Merge[] {
  const n = distance.length
  const clusters: number[][] = Array.from({ length: n }, (_, i) => [i])
  const ids = clusters.map((_, i) => i)
  /**
   * Average distance between all card pairs of two clusters.
   *
   * @param {number[]} a Card indices of the first cluster.
   * @param {number[]} b Card indices of the second cluster.
   * @returns {number} Average linkage distance.
   */
  const linkage = (a: number[], b: number[]): number => {
    let sum = 0
    for (const i of a) for (const j of b) sum += distance[i][j]
    return sum / (a.length * b.length)
  }
  const merges: Merge[] = []
  while (clusters.length > 1) {
    let best = Infinity
    let bi = -1
    let bj = -1
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = linkage(clusters[i], clusters[j])
        if (d < best) {
          best = d
          bi = i
          bj = j
        }
      }
    }
    clusters[bi] = clusters[bi].concat(clusters[bj])
    clusters.splice(bj, 1)
    merges.push({ a: ids[bi], b: ids[bj], distance: best, size: clusters[bi].length })
    ids[bi] = n + merges.length - 1
    ids.splice(bj, 1)
  }
  return merges
}

/**
 * Leaf order of the dendrogram.
 *
 * @param {number} n Number of cards.
 * @param {Merge[]} merges Merge steps from {@link hac}.
 * @returns {number[]} Card indices from top to bottom.
 */
export function leafOrder(n: number, merges: Merge[]): number[] {
  if (merges.length === 0) return Array.from({ length: n }, (_, i) => i)
  /**
   * Collects the leaves below a node, left subtree first.
   *
   * @param {number} node Node id.
   * @returns {number[]} Card indices below the node.
   */
  const walk = (node: number): number[] =>
    node < n ? [node] : [...walk(merges[node - n].a), ...walk(merges[node - n].b)]
  return walk(n + merges.length - 1)
}

// --- Groups and group names --------------------------------------------------------------

/**
 * One group of a submission with its cards.
 *
 * @property {string} name Group name as entered.
 * @property {string[]} cardIds Cards in card-set order; empty for empty frames.
 */
export interface GroupContent {
  name: string
  cardIds: string[]
}

/**
 * Cards of a submission by group.
 *
 * @property {GroupContent[]} groups All frames, including empty ones.
 * @property {string[]} ungrouped On the canvas but in no frame (grey), including cards whose
 *   `groupId` has no frame.
 * @property {string[]} notPlaced Still in the stack, or missing from the submission (e.g. older
 *   card set).
 */
export interface SubmissionGroups {
  groups: GroupContent[]
  ungrouped: string[]
  notPlaced: string[]
}

/**
 * Resolves a submission into its groups with their cards.
 *
 * @param {string[]} cardIds Cards in canonical order.
 * @param {SortState} state Sort state of the submission.
 * @returns {SubmissionGroups} Groups, ungrouped and not placed cards.
 */
export function submissionGroups(cardIds: string[], state: SortState): SubmissionGroups {
  const byCard = new Map(state.placements.map((p) => [p.cardId, p]))
  const groups = state.groups.map((g) => ({ id: g.id, name: g.name, cardIds: [] as string[] }))
  const byId = new Map(groups.map((g) => [g.id, g]))
  const ungrouped: string[] = []
  const notPlaced: string[] = []
  for (const id of cardIds) {
    const p = byCard.get(id)
    if (!p || !p.onCanvas) notPlaced.push(id)
    else {
      const g = p.groupId === null ? undefined : byId.get(p.groupId)
      if (g) g.cardIds.push(id)
      else ungrouped.push(id)
    }
  }
  return { groups: groups.map(({ name, cardIds }) => ({ name, cardIds })), ungrouped, notPlaced }
}

/**
 * Normalizes a group name into a counting key (trimmed, lowercase, single spaces).
 *
 * @param {string} name Group name.
 * @returns {string} Counting key.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Name type of group names that match no or several marker types. */
export const UNCLEAR_NAME_TYPE = 'unklar'

/**
 * Pre-codes a group name by marker words. A type matches if a word of the name BEGINS with one
 * of its stems — "ton" matches "Tonaufnahmen", but "tier" does not match "sortieren".
 *
 * @param {string} name Group name.
 * @param {NameMarkers} markers Marker word list.
 * @returns {string} Key of the only matching type, otherwise {@link UNCLEAR_NAME_TYPE}.
 */
export function codeName(name: string, markers: NameMarkers): string {
  const words = normalizeName(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const hits = markers.types.filter((t) =>
    words.some((w) => t.stems.some((stem) => w.startsWith(stem))),
  )
  return hits.length === 1 ? hits[0].key : UNCLEAR_NAME_TYPE
}

/**
 * Statistics of one normalized group name across the submissions.
 *
 * @property {string} normalized Counting key ({@link normalizeName}).
 * @property {{ name: string; count: number }[]} variants Original spellings, most frequent first.
 * @property {number} count Number of groups with this name.
 * @property {Record<string, number>} cardCounts Card id → how often it lay under this name.
 * @property {number[]} participantNos Submissions using the name.
 * @property {string} [type] Pre-coded name type; only if marker words were passed.
 */
export interface NameStat {
  normalized: string
  variants: { name: string; count: number }[]
  count: number
  cardCounts: Record<string, number>
  participantNos: number[]
  type?: string
}

/**
 * Group-name statistics over all submissions; only groups with at least one card count.
 *
 * @param {{ participantNo: number; groups: SubmissionGroups }[]} submissions Grouped submissions.
 * @param {NameMarkers} [markers] Marker words; enables the pre-coding.
 * @returns {NameStat[]} One entry per normalized name, most frequent first.
 */
export function nameStats(
  submissions: { participantNo: number; groups: SubmissionGroups }[],
  markers?: NameMarkers,
): NameStat[] {
  const stats = new Map<string, NameStat & { variantCounts: Map<string, number> }>()
  for (const sub of submissions) {
    for (const g of sub.groups.groups) {
      if (g.cardIds.length === 0) continue
      const key = normalizeName(g.name)
      let s = stats.get(key)
      if (!s) {
        s = {
          normalized: key,
          variants: [],
          count: 0,
          cardCounts: {},
          participantNos: [],
          variantCounts: new Map(),
          ...(markers ? { type: codeName(g.name, markers) } : {}),
        }
        stats.set(key, s)
      }
      s.count++
      s.variantCounts.set(g.name.trim(), (s.variantCounts.get(g.name.trim()) ?? 0) + 1)
      for (const id of g.cardIds) s.cardCounts[id] = (s.cardCounts[id] ?? 0) + 1
      if (!s.participantNos.includes(sub.participantNo)) s.participantNos.push(sub.participantNo)
    }
  }
  return [...stats.values()]
    .map(({ variantCounts, ...s }) => ({
      ...s,
      variants: [...variantCounts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.count - a.count || a.normalized.localeCompare(b.normalized))
}

// --- Overall analysis of a session ------------------------------------------------------

/**
 * Metrics of one submission against one schema: the fields of {@link PairAgreement} plus ARI and
 * per-category hit rates.
 *
 * @property {number} ari Adjusted Rand Index ({@link adjustedRandIndex}).
 * @property {(number | null)[]} categoryHitRates Hit rate per category (index as in
 *   `schema.categories`; `null` for categories with fewer than two cards), see
 *   {@link categoryHitRates}.
 */
export interface SchemaResult extends PairAgreement {
  ari: number
  categoryHitRates: (number | null)[]
}

/**
 * Analysis of one submission.
 *
 * @property {number} participantNo Running number of the submission within the session.
 * @property {string} createdAt Time of the first submission.
 * @property {string} updatedAt Time of the last update.
 * @property {Lang | null} lang Language sorted in; `null` = old submission (German).
 * @property {string | null} studentId Optional student identifier/pseudonym.
 * @property {SubmissionGroups} groups Cards by group.
 * @property {number} groupCount Frames with at least one card.
 * @property {Record<string, SchemaResult>} schemas Metrics per usable schema.
 * @property {string[]} bestSchemas Schemas with the highest score ({@link bestSchemas}).
 * @property {number | null} deepStructureLead Net lead ({@link deepStructureLead}).
 */
export interface SubmissionAnalysis {
  participantNo: number
  createdAt: string
  updatedAt: string
  lang: Lang | null
  studentId: string | null
  groups: SubmissionGroups
  groupCount: number
  schemas: Record<string, SchemaResult>
  bestSchemas: string[]
  deepStructureLead: number | null
}

/** Class means of the metrics over the submissions. */
export type SchemaMeans = SchemaResult

/**
 * Overall analysis of a session — the data of the analysis dashboard and the exports.
 *
 * @property {string[]} cardIds Row/column order of all matrices.
 * @property {string[]} schemaKeys Usable schemas in display order.
 * @property {number} submissionCount Number of submissions analyzed.
 * @property {number[][]} cooccurrence Number of submissions per card pair.
 * @property {number[][]} shares Same matrix as share of submissions ({@link cooccurrenceShares}).
 * @property {Merge[]} merges HAC on `1 − share`.
 * @property {number[]} leafOrder Dendrogram leaf order.
 * @property {Record<string, SchemaMeans>} means Class means per usable schema; empty without
 *   submissions.
 * @property {number | null} deepStructureBestShare Share of submissions whose deep-structure
 *   score lies STRICTLY above all surface schemas (net lead > 0); `null` without submissions or
 *   without usable schemas of both roles.
 * @property {SubmissionAnalysis[]} submissions Analysis per submission.
 * @property {NameStat[]} names Group-name statistics.
 */
export interface SessionAnalysis {
  cardIds: string[]
  schemaKeys: string[]
  submissionCount: number
  cooccurrence: number[][]
  shares: number[][]
  merges: Merge[]
  leafOrder: number[]
  means: Record<string, SchemaMeans>
  deepStructureBestShare: number | null
  submissions: SubmissionAnalysis[]
  names: NameStat[]
}

/**
 * One stored submission as input of the analysis.
 *
 * @property {number} participantNo Running number within the session.
 * @property {string} createdAt Time of the first submission.
 * @property {string} updatedAt Time of the last update.
 * @property {SortState} state Submitted sort state.
 * @property {string | null} [studentId] Optional student identifier/pseudonym.
 */
export interface SubmissionInput {
  participantNo: number
  createdAt: string
  updatedAt: string
  state: SortState
  studentId?: string | null
}

/**
 * Arithmetic mean.
 *
 * @param {number[]} xs Non-empty list of values.
 * @returns {number} Mean of the values.
 */
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/**
 * Computes the complete analysis of a session: metrics per submission, class means,
 * co-occurrence, clustering and group names.
 *
 * @param {CardRef[]} cards Card set in canonical order.
 * @param {Schema[]} schemas All reference schemas; unusable ones are dropped.
 * @param {SubmissionInput[]} submissions Only the included submissions.
 * @param {NameMarkers} [markers] Enables the pre-coding of group names.
 * @returns {SessionAnalysis} Overall analysis.
 */
export function analyzeSession(
  cards: CardRef[],
  schemas: Schema[],
  submissions: SubmissionInput[],
  markers?: NameMarkers,
): SessionAnalysis {
  const cardIds = cards.map((c) => c.id)
  const usable = usableSchemas(cards, schemas)
  const refs = usable.map((s) => ({ schema: s, ref: referencePartition(cards, s) as number[] }))

  const subs: SubmissionAnalysis[] = submissions.map((sub) => {
    const partition = partitionOf(cardIds, sub.state.placements)
    const groups = submissionGroups(cardIds, sub.state)
    const results: Record<string, SchemaResult> = {}
    for (const { schema, ref } of refs) {
      results[schema.key] = {
        ...pairAgreement(partition, ref),
        ari: adjustedRandIndex(partition, ref),
        categoryHitRates: categoryHitRates(partition, ref, schema.categories.length),
      }
    }
    const scores = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.score]))
    return {
      participantNo: sub.participantNo,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
      lang: sub.state.lang ?? null,
      studentId: sub.studentId ?? null,
      groups,
      groupCount: groups.groups.filter((g) => g.cardIds.length > 0).length,
      schemas: results,
      bestSchemas: bestSchemas(scores),
      deepStructureLead: deepStructureLead(scores, usable),
    }
  })

  const means: Record<string, SchemaMeans> = {}
  if (subs.length > 0) {
    for (const { schema } of refs) {
      const rs = subs.map((s) => s.schemas[schema.key])
      means[schema.key] = {
        hitRate: mean(rs.map((r) => r.hitRate)),
        separationRate: mean(rs.map((r) => r.separationRate)),
        score: mean(rs.map((r) => r.score)),
        ari: mean(rs.map((r) => r.ari)),
        categoryHitRates: schema.categories.map((_, k) => {
          const xs = rs.map((r) => r.categoryHitRates[k]).filter((x): x is number => x !== null)
          return xs.length === 0 ? null : mean(xs)
        }),
      }
    }
  }

  const leads = subs.map((s) => s.deepStructureLead).filter((x): x is number => x !== null)
  const cooccurrence = buildAggregateMatrix(cards, submissions.map((s) => s.state))
  const shares = cooccurrenceShares(cooccurrence, submissions.length)
  const merges = hac(shares.map((row) => row.map((v) => 1 - v)))

  return {
    cardIds,
    schemaKeys: usable.map((s) => s.key),
    submissionCount: submissions.length,
    cooccurrence,
    shares,
    merges,
    leafOrder: leafOrder(cardIds.length, merges),
    means,
    deepStructureBestShare:
      leads.length === 0 ? null : leads.filter((x) => x > EPS).length / leads.length,
    submissions: subs,
    names: nameStats(subs, markers),
  }
}

// --- Session comparison -----------------------------------------------------------------

/**
 * Class means of one session for the side-by-side comparison.
 *
 * @property {string} sessionKey Session key.
 * @property {number} submissionCount Number of submissions.
 * @property {Record<string, number>} scores Mean score per schema.
 * @property {Record<string, (number | null)[]>} categoryHitRates Mean hit rate per category,
 *   per schema.
 * @property {number | null} deepStructureBestShare See {@link SessionAnalysis}.
 */
export interface SessionComparison {
  sessionKey: string
  submissionCount: number
  scores: Record<string, number>
  categoryHitRates: Record<string, (number | null)[]>
  deepStructureBestShare: number | null
}

/**
 * Reduces several session analyses to their class means; sessions are not pooled.
 *
 * @param {{ sessionKey: string; analysis: SessionAnalysis }[]} sessions Analyzed sessions.
 * @returns {SessionComparison[]} One entry per session, in input order.
 */
export function compareSessions(
  sessions: { sessionKey: string; analysis: SessionAnalysis }[],
): SessionComparison[] {
  return sessions.map(({ sessionKey, analysis }) => ({
    sessionKey,
    submissionCount: analysis.submissionCount,
    scores: Object.fromEntries(Object.entries(analysis.means).map(([k, m]) => [k, m.score])),
    categoryHitRates: Object.fromEntries(
      Object.entries(analysis.means).map(([k, m]) => [k, m.categoryHitRates]),
    ),
    deepStructureBestShare: analysis.deepStructureBestShare,
  }))
}
