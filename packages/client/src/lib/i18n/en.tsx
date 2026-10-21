import type { ReactNode } from 'react'
import type { Dict } from './de'

/** Class data of a session; same shape as in `de.tsx`. */
interface ClassInfoText {
  klassenstufe: string
  schulform: string
  mlVorwissen: string
  bundesland: string | null
  note: string | null
}

/**
 * Joins words into an English list. Categories stand mid-sentence, so every entry after the first
 * is lower-cased ("Reinforcement learning and regression").
 *
 * @param {string[]} xs Words to join.
 * @returns {string} Localized list.
 */
const listEn = (xs: string[]) =>
  new Intl.ListFormat('en', { type: 'conjunction' }).format(
    xs.map((x, i) => (i === 0 ? x : x.toLowerCase())),
  )

/**
 * English dictionary, typed as {@link Dict}: a missing or mistyped entry breaks the build.
 * Entries and their function parameters are documented in {@link de}.
 */
export const en: Dict = {
  langName: 'English',

  menu: {
    open: 'Menu',
    create: 'Create session',
    join: 'Join session',
    manage: 'Manage session',
    legal: 'Legal notice & privacy',
    source: 'Source code (AGPL)',
    language: 'Language',
  },

  sort: {
    task: (
      <>
        <strong>Sort</strong> the AI problems on the cards into <strong>groups</strong> based on which ones can be <strong>solved in a similar way</strong>.
      </>
    ),
    helpButton: 'Instructions',
    help: [
      'Drag cards from the stack onto the board. Tapping opens a card. The pin icon keeps a card open.',
      'Every card has to sit inside a group. To create a new group, drag out a frame. Before submitting, every group containing cards needs its own name.',
    ],
    session: (key: string) => (
      <>
        Session: <strong>{key}</strong>
      </>
    ),

    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Zoom to 100%',
    zoomResetTitle: 'Reset to 100%',

    submit: 'Submit',
    continue: 'Keep sorting',
    handover: 'Done — next person',
    resetAsk: 'Reset everything?',
    resetConfirm: 'Yes, reset',
    cancel: 'Cancel',
    loading: 'Loading...',

    msg: {
      ungrouped: (n: number) => `${n} ${n === 1 ? 'card' : 'cards'} still without a group`,
      unnamed: (n: number) => `${n} ${n === 1 ? 'frame' : 'frames'} still without a name`,
      frozen: 'The survey has been closed — your sorting from earlier counts',
      notCounted: 'The survey has been closed — this submission is no longer counted.',
      thanks: 'Submitted — thank you!',
      unknownSession: 'This session does not exist (any more). Please check the session key.',
      failed: 'Sending failed. Please check your connection.',
      readyForNext: 'Ready for the next person.',
    },
  },

  resume: {
    title: 'There is already a sorting here',
    text: (age: string) => (
      <>
        Someone sorted on this device <strong>{age}</strong>. Is this your sorting?
      </>
    ),
    age: (minutes: number) => {
      if (minutes < 1) return 'just now'
      if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
      const hours = Math.round(minutes / 60)
      return `${hours} hour${hours === 1 ? '' : 's'} ago`
    },
    yes: 'Yes, keep sorting',
    no: 'No, start over',
  },

  card: {
    pin: 'Pin text',
    unpin: 'Unpin text',
  },

  group: {
    placeholder: (index: number) => `Group ${index}`,
    nameLabel: 'Group name',
    delete: 'Delete group',
  },
  dash: {
    back: '← to the sorting view',
    loading: 'Loading…',
    refresh: 'Refresh',
  },

  admin: {
    title: (key: string) => `Manage — session ${key}`,
    heading: 'Manage session',
    notFound: 'Session not found (wrong management key?).',
    otherKey: '← enter a different management key',
    deletedTitle: 'Session deleted',
    deletedText: 'The session and all submissions have been removed.',
    status: 'Status',
    closedAt: (date: string) => `closed on ${date}`,
    running: 'running',
    submissions: 'Submissions',
    excluded: (n: number) => `${n} after closing (ignored)`,
    keyHint: (key: ReactNode) => (
      <>
        Management key: {key} (keep it secret — it brings you back here via “Manage session”)
      </>
    ),
    classInfo: (s: ClassInfoText) =>
      [
        `Grade ${s.klassenstufe}`,
        s.schulform,
        `ML prior knowledge ${s.mlVorwissen}`,
        s.bundesland,
        s.note,
      ]
        .filter(Boolean)
        .join(' · '),
    close: 'Close survey',
    reopen: 'Reopen',
    remove: 'Delete',
    confirmClose: 'Close the survey? Later submissions will no longer count.',
    confirmDelete: 'Permanently delete the session and all submissions?',
    exportsLabel: 'Exports',
    csvMatrix: 'CSV · aggregate matrix',
    jsonRaw: 'JSON · raw data',
    csvMetrics: 'CSV · metrics per submission',
    csvNames: 'CSV · group names',
    jsonGroups: 'JSON · groups per submission',
    cardSet: (v: string) => `Card set ${v}`,
    cardSetOutdated:
      'This session was run with an older card set. The analysis uses the current card set — individual cards may since have changed wording, been reclassified or been removed.',
    submissionsTitle: (n: number) => `Submissions (${n})`,
    noSubmissions: 'No submissions yet.',
    colCreated: 'submitted',
    colUpdated: 'updated',
    analysisTitle: 'Group analysis',
    analysisLater: 'The analysis appears as soon as the survey is closed.',
  },

  master: {
    title: 'Master analysis',
    unavailable: 'Analysis not available (invalid master link?).',
    summary: (shown: number, total: number, subs: number) =>
      `${shown} of ${total} sessions · ${subs} counted submissions in the selection`,
    excluded: (n: number) => `${n} after closing (not counted)`,
    search: 'Search',
    searchPlaceholder: 'Key, grade, school type, note…',
    from: 'Created from',
    to: 'Created until',
    resetFilter: 'Reset filter',
    col: {
      key: 'Key',
      klassenstufe: 'Grade',
      schulform: 'School type',
      mlVorwissen: 'ML prior knowledge',
      bundesland: 'Federal state',
      status: 'Status',
      submissions: 'Submissions',
      created: 'Created',
      lastActivity: 'Last activity',
      note: 'Note',
    },
    select: (key: string) => `Select session ${key}`,
    selectAll: 'Select all filtered sessions',
    submissionsTitle: 'counted up to the closing date',
    excludedTitle: 'received after closing — not counted',
    open: 'open',
    closed: 'closed',
    closedOn: (date: string) => `closed on ${date}`,
    practice: 'practice mode',
    practiceTitle:
      'Default session: submissions without a session link, not assigned to any class. Only included when explicitly selected.',
    noMatch: 'No sessions match the filter.',

    analysisTitle: 'Analysis of selected sessions',
    analysisHint:
      'Select sessions in the table and analyse them. Each session is analysed on its own — not pooled.',
    analyze: (n: number) => `Analyse (${n})`,
    analysisFailed: 'The analysis could not be loaded.',
    comparisonTitle: 'Session comparison',
    comparisonHelp: 'Class means per session side by side — deliberately not pooled.',
    comparisonCategories: (schema: string) => `Hit rate per ${schema.toLowerCase()}`,
    colSession: 'Session',
    colN: 'n',
    colDeepBest: (schema: string) => `${schema} ahead`,
    sessionPick: 'Session',
    stillOpen: 'still running',
    cardSet: (v: string) => `Card set ${v}`,
    cardSetOutdated: (keys: string[]) =>
      `${keys.length === 1 ? 'Session' : 'Sessions'} ${keys.join(', ')} ${keys.length === 1 ? 'was' : 'were'} run with an older card set. The analysis uses the current card set — individual cards may since have changed wording, been reclassified or been removed. The session comparison is of limited validity in that case.`,
    cardSetOutdatedSession:
      'Older card set: the analysis uses the current card set — individual cards may since have changed wording, been reclassified or been removed.',

    exportTitle: 'Exports',
    scope: 'Scope',
    scopeFiltered: (n: number) => `Filtered sessions (${n})`,
    scopeSelected: (n: number) => `Selected sessions (${n})`,
    scopeAll: 'All sessions except the default session',
    scopeEmpty: 'No sessions in the chosen scope.',
    csvMatrix: 'CSV · aggregate matrix',
    csvSessions: 'CSV · session overview',
    csvMetrics: 'CSV · metrics per submission',
    csvNames: 'CSV · group names (with pre-coding)',
    jsonRaw: 'JSON · raw data',
    jsonGroups: 'JSON · groups per submission',
  },

  ana: {
    tabsLabel: 'Sections of the analysis',
    tabs: {
      overview: 'Overview',
      charts: 'Visualisations',
      names: 'Group names',
      submissions: 'Individual submissions',
    },
    empty: 'There are no counted submissions.',
    noSchemas:
      'The card set has no complete reference features — agreement values are therefore not shown. Graph, heatmap and dendrogram still work.',
    none: '–',

    kpiSubmissions: 'Submissions',
    kpiDeepBest: (schema: string) =>
      `of submissions are closest to the sorting by ${schema.toLowerCase()}`,
    kpiGroups: 'groups per submission on average',

    scoreTitle: 'Agreement with the reference sortings',
    scoreHelp:
      'How similar are the sortings to a sorting strictly by each feature? 50% corresponds to chance, 100% to an identical sorting.',
    scoreLabel: (schema: string) => `by ${schema.toLowerCase()}`,
    chance: 'chance',
    categoryTitle: (schema: string) => `Hit rate per ${schema.toLowerCase()}`,
    categoryHelp:
      'Share of card pairs within a category that were placed in the same group (mean across all submissions).',
    categorySingle: 'single card',

    readingTitle: 'In short',
    reading: {
      nearChance:
        'The sortings do not yet clearly follow any of the reference features — all agreement values are close to chance level.',
      leaning: (toward: string, over: string) =>
        `The group sorts more by ${toward.toLowerCase()} than by ${over.toLowerCase()}.`,
      balanced: (a: string, b: string) =>
        `${a} and ${b.toLowerCase()} shape the sortings about equally.`,
      recognized: (cats: string[]) =>
        `${listEn(cats)} ${cats.length === 1 ? 'is' : 'are'} often recognised.`,
      hardly: (cats: string[]) =>
        `${listEn(cats)} ${cats.length === 1 ? 'is' : 'are'} hardly recognised.`,
      split: (count: number, total: number, schema: string) =>
        `In ${count} of ${total} ${total === 1 ? 'submission' : 'submissions'}, the sorting by ${schema.toLowerCase()} comes out ahead.`,
    },

    charts: {
      viewLabel: 'View',
      views: {
        graph: 'Card graph',
        heatmap: 'Heatmap',
        dendrogram: 'Dendrogram',
        categories: 'Hit rates',
      },
      schema: 'Reference scheme',
      graphHelp:
        'The closer two cards are to each other, the more often they were sorted into the same group. Lines show the strongest connections.',
      graphEmpty:
        'No card pairs grouped together yet — the graph appears here as soon as there are submissions.',
      graphAria: 'Co-occurrence graph of the cards',
      heatmapHelp:
        'Share of submissions in which two cards were placed in the same group. Outlined: cards of the same category of the reference scheme.',
      heatmapHelpNoSchema:
        'Share of submissions in which two cards were placed in the same group. Ordered by the cluster analysis.',
      heatmapCell: (a: string, b: string, pct: string, count: number, n: number) =>
        `${a} and ${b}: ${pct} (${count} of ${n} ${n === 1 ? 'submission' : 'submissions'})`,
      heatmapAria: 'Heatmap of co-occurrence shares',
      scale: 'sorted together',
      dendroHelp:
        'The diagram shows which cards the class sees as belonging together: on the left each card stands alone; towards the right they are combined step by step into ever larger groups. The further left two branches join, the more often the cards were placed together. Dashed: whatever joins left of it was placed together in at least half of the submissions on average.',
      dendroAxis: 'sorted together on average',
      dendroMerge: (pct: string, cards: string) => `On average ${pct} sorted together: ${cards}`,
      dendroAria: 'Dendrogram of the cards',
      tapHint: 'Hover or tap for values.',
    },

    names: {
      search: 'Search',
      searchPlaceholder: 'Name contains …',
      cardFilter: 'Card',
      allCards: 'All',
      summary: (names: number, groups: number) =>
        `${names} distinct names for ${groups} groups. Spellings that differ only in capitalisation or spaces are merged.`,
      forCard: (card: string) => `Names of the groups that contained ${card}:`,
      none: 'No names match the filter.',
      times: (n: number) => `${n}×`,
      variants: (v: string) => `also: ${v}`,
      cardCount: (card: string, n: number) => `${card}: ${n}× under this name`,
      usedBy: (n: number) => `${n} ${n === 1 ? 'submission' : 'submissions'}`,
      codingTitle: 'Automatic pre-coding — unverified',
      codingHelp:
        'Rough classification of the names via marker words (name-markers.json): process, application domain or data representation. Not validated — only a first orientation; shares refer to all groups.',
      unclear: 'unclear',
    },

    subs: {
      distTitle: 'Distribution of submissions',
      distHelp: (deep: string) =>
        `Each dot is one submission. Right of the centre it is closer to the sorting by ${deep.toLowerCase()}, left of it closer to a surface feature.`,
      left: 'closer to surface features',
      right: (deep: string) => `closer to ${deep.toLowerCase()}`,
      axis: 'Difference in percentage points',
      dotInfo: (no: number, closer: string, closerPct: string, other: string, otherPct: string, diff: string) =>
        `Submission ${no} fits the sorting by ${closer.toLowerCase()} (${closerPct}) better than the one by ${other.toLowerCase()} (${otherPct}): a difference of ${diff} percentage points.`,
      dotInfoTie: (no: number, a: string, b: string, pct: string) =>
        `Submission ${no} fits the sortings by ${a.toLowerCase()} and by ${b.toLowerCase()} equally well (${pct} each).`,
      dotAria: 'Dot plot of the score per submission',
      open: 'Open submission',
      tableTitle: 'All submissions',
      tableHelp: 'Tap a row to open the submission. Column headers sort the table.',
      columns: 'Columns',
      col: {
        no: 'No.',
        time: 'Time',
        groups: 'Groups',
        studentId: 'Student ID',
        best: 'closest to',
        lead: 'Score',
        lang: 'Language',
      },
      ari: (schema: string) => `ARI ${schema.toLowerCase()}`,
      leadHelp: (deep: string) =>
        `Score: agreement with the sorting by ${deep.toLowerCase()} minus the highest agreement with a surface feature, in percentage points. Positive = closer to ${deep.toLowerCase()}.`,
      detailTitle: (no: number) => `Submission ${no}`,
      close: 'Close',
      sorting: 'Sorting',
      unnamed: '(unnamed)',
      ungrouped: 'not in a group',
      notPlaced: 'not placed',
      colorNote: (schema: string) => `Coloured dot on a card: category by ${schema.toLowerCase()}.`,
    },
  },
}
