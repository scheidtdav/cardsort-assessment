import type { ReactNode } from 'react'

/**
 * Class data of a session as shown in the admin view header.
 *
 * @property {string} klassenstufe Grade.
 * @property {string} schulform School type.
 * @property {string} mlVorwissen Prior ML knowledge of the class.
 * @property {string | null} bundesland Federal state, if given.
 * @property {string | null} note Free note of the teacher, if given.
 */
interface ClassInfoText {
  klassenstufe: string
  schulform: string
  mlVorwissen: string
  bundesland: string | null
  note: string | null
}

/**
 * Joins words into a German list ("A, B und C").
 *
 * @param {string[]} xs Words to join.
 * @returns {string} Localized list.
 */
const listDe = (xs: string[]) => new Intl.ListFormat('de', { type: 'conjunction' }).format(xs)

/**
 * German dictionary — source of truth: its shape defines {@link Dict}, which every other language
 * must match. Plain strings, plus functions for plurals, sentence building and inline markup.
 */
export const de = {
  langName: 'Deutsch',

  menu: {
    open: 'Menü',
    create: 'Sitzung anlegen',
    join: 'Sitzung beitreten',
    manage: 'Sitzung verwalten',
    legal: 'Impressum & Datenschutz',
    source: 'Quellcode (AGPL)',
    language: 'Sprache',
  },

  sort: {
    task: (
      <>
        <strong>Gruppiere</strong>, welche der KI-Probleme auf den Karten auf eine{' '}
        <strong>ähnliche Weise gelöst</strong> werden können.
      </>
    ),
    helpButton: 'Anleitung',
    help: [
      'Ziehe Karten vom Stapel auf die Fläche. Tippen öffnet eine Karte. Mit dem Pin-Symbol bleibt die Karte geöffnet.',
      'Jede Karte muss in einer Gruppe liegen. Um eine neue Gruppe zu erstellen, ziehe einen Rahmen. Vor dem Absenden braucht jede Gruppe mit Karten einen eigenen Namen.',
    ],
    /**
     * Session indicator above the canvas.
     *
     * @param {string} key Session key.
     * @returns {JSX.Element} Label with the key in bold.
     */
    session: (key: string) => (
      <>
        Sitzung: <strong>{key}</strong>
      </>
    ),

    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    zoomReset: 'Zoom auf 100 %',
    zoomResetTitle: 'Auf 100 % setzen',

    submit: 'Absenden',
    continue: 'Weiter sortieren',
    handover: 'Fertig — Neue Person',
    resetAsk: 'Alles zurücksetzen?',
    resetConfirm: 'Ja, zurücksetzen',
    cancel: 'Abbrechen',
    loading: 'Lädt...',

    msg: {
      /**
       * Submit hint: cards still outside a group.
       *
       * @param {number} n Number of ungrouped cards.
       * @returns {string} Hint text.
       */
      ungrouped: (n: number) => `Noch ${n} ${n === 1 ? 'Karte' : 'Karten'} ohne Gruppe`,
      /**
       * Submit hint: frames with cards but without name.
       *
       * @param {number} n Number of unnamed frames.
       * @returns {string} Hint text.
       */
      unnamed: (n: number) => `Noch ${n} Rahmen ohne Namen`,
      frozen: 'Die Befragung ist abgeschlossen — gezählt wird dein Stand von vorhin.',
      notCounted: 'Die Befragung ist abgeschlossen — diese Abgabe wird nicht mehr mitgezählt.',
      thanks: 'Abgesendet — danke!',
      unknownSession: 'Diese Sitzung gibt es nicht (mehr). Sitzungs-Schlüssel prüfen.',
      failed: 'Senden fehlgeschlagen. Verbindung prüfen.',
      readyForNext: 'Bereit für die nächste Person.',
    },
  },

  resume: {
    title: 'Hier liegt schon eine Sortierung',
    /**
     * Resume prompt for a saved draft.
     *
     * @param {string} age Age phrase from {@link de.resume.age}.
     * @returns {JSX.Element} Prompt text.
     */
    text: (age: string) => (
      <>
        Auf diesem Gerät wurde <strong>{age}</strong> sortiert. Ist das deine Sortierung?
      </>
    ),
    /**
     * Age of a draft as relative phrase; minutes and hours suffice, drafts expire after 12 h.
     *
     * @param {number} minutes Age in minutes.
     * @returns {string} E.g. "vor 5 Minuten".
     */
    age: (minutes: number) => {
      if (minutes < 1) return 'gerade eben'
      if (minutes < 60) return `vor ${minutes} Minute${minutes === 1 ? '' : 'n'}`
      const hours = Math.round(minutes / 60)
      return `vor ${hours} Stunde${hours === 1 ? '' : 'n'}`
    },
    yes: 'Ja, weitersortieren',
    no: 'Nein, neu anfangen',
  },

  card: {
    pin: 'Text anheften',
    unpin: 'Text lösen',
  },

  group: {
    /**
     * Placeholder name of an unnamed group.
     *
     * @param {number} index 1-based group number.
     * @returns {string} Placeholder text.
     */
    placeholder: (index: number) => `Gruppe ${index}`,
    nameLabel: 'Gruppenname',
    delete: 'Gruppe löschen',
  },

  // --- Dashboards (admin, master, analysis) ---

  dash: {
    back: '← zur Sortieransicht',
    loading: 'Lädt…',
    refresh: 'Aktualisieren',
  },

  admin: {
    /**
     * Page title of the admin view.
     *
     * @param {string} key Session key.
     * @returns {string} Title.
     */
    title: (key: string) => `Verwaltung — Sitzung ${key}`,
    heading: 'Verwaltung',
    notFound: 'Sitzung nicht gefunden (falscher Verwaltungsschlüssel?).',
    otherKey: '← anderen Verwaltungsschlüssel eingeben',
    deletedTitle: 'Sitzung gelöscht',
    deletedText: 'Die Sitzung und alle Abgaben wurden entfernt.',
    status: 'Status',
    /**
     * Status line of a closed session.
     *
     * @param {string} date Formatted closing date.
     * @returns {string} Status text.
     */
    closedAt: (date: string) => `abgeschlossen am ${date}`,
    running: 'läuft',
    submissions: 'Abgaben',
    /**
     * Note on submissions received after closing.
     *
     * @param {number} n Number of excluded submissions.
     * @returns {string} Note text.
     */
    excluded: (n: number) => `${n} nach Abschluss (ignoriert)`,
    /**
     * Hint that the admin key must be kept secret.
     *
     * @param {ReactNode} key Rendered admin key.
     * @returns {JSX.Element} Hint text.
     */
    keyHint: (key: ReactNode) => (
      <>
        Verwaltungsschlüssel: {key} (geheim halten — damit kommst du über „Sitzung verwalten"
        hierher zurück)
      </>
    ),
    /**
     * One-line summary of the class data, empty fields omitted.
     *
     * @param {ClassInfoText} s Class data of the session.
     * @returns {string} Fields joined by " · ".
     */
    classInfo: (s: ClassInfoText) =>
      [
        `Klassenstufe ${s.klassenstufe}`,
        s.schulform,
        `ML-Vorwissen ${s.mlVorwissen}`,
        s.bundesland,
        s.note,
      ]
        .filter(Boolean)
        .join(' · '),
    close: 'Befragung abschließen',
    reopen: 'Wieder öffnen',
    remove: 'Löschen',
    confirmClose: 'Befragung abschließen? Spätere Abgaben zählen dann nicht mehr.',
    confirmDelete: 'Sitzung und alle Abgaben unwiderruflich löschen?',
    exportsLabel: 'Exporte',
    csvMatrix: 'CSV · Aggregat-Matrix',
    jsonRaw: 'JSON · Rohdaten',
    csvMetrics: 'CSV · Kennwerte je Abgabe',
    csvNames: 'CSV · Gruppennamen',
    jsonGroups: 'JSON · Gruppen je Abgabe',
    /**
     * Card-set version label.
     *
     * @param {string} v Card-set version.
     * @returns {string} Label.
     */
    cardSet: (v: string) => `Kartensatz ${v}`,
    cardSetOutdated:
      'Diese Sitzung wurde mit einem älteren Kartensatz durchgeführt. Die Auswertung nutzt den aktuellen Kartensatz — einzelne Karten können inzwischen anders lauten, anders eingeordnet sein oder fehlen.',
    /**
     * Heading of the submission list.
     *
     * @param {number} n Number of submissions.
     * @returns {string} Heading.
     */
    submissionsTitle: (n: number) => `Abgaben (${n})`,
    noSubmissions: 'Noch keine Abgaben.',
    colCreated: 'abgegeben',
    colUpdated: 'aktualisiert',
    analysisTitle: 'Auswertung der Gruppe',
    analysisLater: 'Die Auswertung erscheint, sobald die Befragung abgeschlossen ist.',
  },

  master: {
    title: 'Master-Auswertung',
    unavailable: 'Auswertung nicht verfügbar (ungültiger Master-Link?).',
    /**
     * Summary line of the session filter.
     *
     * @param {number} shown Sessions matching the filter.
     * @param {number} total All sessions.
     * @param {number} subs Counted submissions of the filtered sessions.
     * @returns {string} Summary.
     */
    summary: (shown: number, total: number, subs: number) =>
      `${shown} von ${total} Sitzungen · ${subs} gezählte Abgaben in der Auswahl`,
    /**
     * Note on submissions received after closing.
     *
     * @param {number} n Number of excluded submissions.
     * @returns {string} Note text.
     */
    excluded: (n: number) => `${n} nach Abschluss (zählen nicht mit)`,
    search: 'Suche',
    searchPlaceholder: 'Key, Klasse, Schulform, Notiz…',
    from: 'Angelegt ab',
    to: 'Angelegt bis',
    resetFilter: 'Filter zurücksetzen',
    col: {
      key: 'Key',
      klassenstufe: 'Klassenstufe',
      schulform: 'Schulform',
      mlVorwissen: 'ML-Vorwissen',
      bundesland: 'Bundesland',
      status: 'Status',
      submissions: 'Abgaben',
      created: 'Angelegt',
      lastActivity: 'Letzte Aktivität',
      note: 'Notiz',
    },
    /**
     * Accessible label of a session checkbox.
     *
     * @param {string} key Session key.
     * @returns {string} Label.
     */
    select: (key: string) => `Sitzung ${key} auswählen`,
    selectAll: 'Alle gefilterten Sitzungen auswählen',
    submissionsTitle: 'gezählt bis zum Abschluss-Stichtag',
    excludedTitle: 'nach dem Abschluss eingegangen — zählen nicht mit',
    open: 'offen',
    closed: 'geschlossen',
    /**
     * Status of a closed session.
     *
     * @param {string} date Formatted closing date.
     * @returns {string} Status text.
     */
    closedOn: (date: string) => `abgeschlossen am ${date}`,
    practice: 'Übungsmodus',
    practiceTitle:
      'Standard-Sitzung: Abgaben ohne Sitzungs-Link, keiner Klasse zugeordnet. Fließt nur ein, wenn sie ausdrücklich ausgewählt ist.',
    noMatch: 'Keine Sitzungen passen zum Filter.',

    analysisTitle: 'Auswertung ausgewählter Sitzungen',
    analysisHint:
      'Sitzungen in der Tabelle auswählen und auswerten. Jede Sitzung wird für sich ausgewertet — nicht gepoolt.',
    /**
     * Analyze button.
     *
     * @param {number} n Number of selected sessions.
     * @returns {string} Button label.
     */
    analyze: (n: number) => `Auswerten (${n})`,
    analysisFailed: 'Die Auswertung konnte nicht geladen werden.',
    comparisonTitle: 'Sitzungsvergleich',
    comparisonHelp: 'Klassenmittel je Sitzung nebeneinander — bewusst nicht gepoolt.',
    /**
     * Heading of the per-category comparison.
     *
     * @param {string} schema Schema label.
     * @returns {string} Heading.
     */
    comparisonCategories: (schema: string) => `Trefferquote je ${schema}`,
    colSession: 'Sitzung',
    colN: 'n',
    /**
     * Column header: share of submissions led by the deep-structure schema.
     *
     * @param {string} schema Schema label.
     * @returns {string} Header.
     */
    colDeepBest: (schema: string) => `${schema} vorn`,
    sessionPick: 'Sitzung',
    stillOpen: 'läuft noch',
    /**
     * Card-set version label.
     *
     * @param {string} v Card-set version.
     * @returns {string} Label.
     */
    cardSet: (v: string) => `Kartensatz ${v}`,
    /**
     * Warning that sessions used an older card set.
     *
     * @param {string[]} keys Keys of the affected sessions.
     * @returns {string} Warning text.
     */
    cardSetOutdated: (keys: string[]) =>
      `${keys.length === 1 ? 'Sitzung' : 'Sitzungen'} ${keys.join(', ')} ${keys.length === 1 ? 'wurde' : 'wurden'} mit einem älteren Kartensatz durchgeführt. Ausgewertet wird gegen den aktuellen Kartensatz — einzelne Karten können inzwischen anders lauten, anders eingeordnet sein oder fehlen. Der Sitzungsvergleich ist dann nur eingeschränkt aussagekräftig.`,
    cardSetOutdatedSession:
      'Älterer Kartensatz: Die Auswertung nutzt den aktuellen Kartensatz — einzelne Karten können inzwischen anders lauten, anders eingeordnet sein oder fehlen.',

    exportTitle: 'Exporte',
    scope: 'Umfang',
    /**
     * Export scope option: filtered sessions.
     *
     * @param {number} n Number of sessions.
     * @returns {string} Option label.
     */
    scopeFiltered: (n: number) => `Gefilterte Sitzungen (${n})`,
    /**
     * Export scope option: selected sessions.
     *
     * @param {number} n Number of sessions.
     * @returns {string} Option label.
     */
    scopeSelected: (n: number) => `Ausgewählte Sitzungen (${n})`,
    scopeAll: 'Alle Sitzungen ohne Standard-Sitzung',
    scopeEmpty: 'Keine Sitzungen im gewählten Umfang.',
    csvMatrix: 'CSV · Aggregat-Matrix',
    csvSessions: 'CSV · Sitzungs-Übersicht',
    csvMetrics: 'CSV · Kennwerte je Abgabe',
    csvNames: 'CSV · Gruppennamen (mit Vorkodierung)',
    jsonRaw: 'JSON · Rohdaten',
    jsonGroups: 'JSON · Gruppen je Abgabe',
  },

  ana: {
    tabsLabel: 'Bereiche der Auswertung',
    tabs: {
      overview: 'Überblick',
      charts: 'Visualisierungen',
      names: 'Gruppennamen',
      submissions: 'Einzelne Abgaben',
    },
    empty: 'Es liegen keine gezählten Abgaben vor.',
    noSchemas:
      'Für den Kartensatz sind keine vollständigen Referenzmerkmale hinterlegt — Übereinstimmungswerte werden deshalb nicht angezeigt. Graph, Heatmap und Dendrogramm funktionieren trotzdem.',
    none: '–',

    kpiSubmissions: 'Abgaben',
    /**
     * KPI label: share of submissions closest to the deep-structure schema.
     *
     * @param {string} schema Schema label.
     * @returns {string} Label.
     */
    kpiDeepBest: (schema: string) =>
      `der Abgaben liegen am nächsten an der Sortierung nach ${schema}`,
    kpiGroups: 'Gruppen je Abgabe im Mittel',

    scoreTitle: 'Übereinstimmung mit den Referenzsortierungen',
    scoreHelp:
      'Wie ähnlich sind die Sortierungen einer Sortierung genau nach dem jeweiligen Merkmal? 50 % entspricht dem Zufall, 100 % einer identischen Sortierung.',
    /**
     * Bar label of a reference schema.
     *
     * @param {string} schema Schema label.
     * @returns {string} Label.
     */
    scoreLabel: (schema: string) => `nach ${schema}`,
    chance: 'Zufall',
    /**
     * Heading of the hit rates per category.
     *
     * @param {string} schema Schema label.
     * @returns {string} Heading.
     */
    categoryTitle: (schema: string) => `Trefferquote je ${schema}`,
    categoryHelp:
      'Anteil der Kartenpaare einer Kategorie, die gemeinsam in einer Gruppe lagen (Mittel über alle Abgaben).',
    categorySingle: 'nur eine Karte',

    readingTitle: 'Kurz gesagt',
    reading: {
      nearChance:
        'Die Sortierungen folgen noch keinem der Referenzmerkmale deutlich — alle Übereinstimmungen liegen nahe am Zufallsniveau.',
      /**
       * Reading text: the class leans toward one schema.
       *
       * @param {string} toward Label of the favoured schema.
       * @param {string} over Label of the other schema.
       * @returns {string} Sentence.
       */
      leaning: (toward: string, over: string) =>
        `Die Gruppe sortiert eher nach ${toward} als nach ${over}.`,
      /**
       * Reading text: two schemas on par.
       *
       * @param {string} a Schema label.
       * @param {string} b Schema label.
       * @returns {string} Sentence.
       */
      balanced: (a: string, b: string) =>
        `${a} und ${b} prägen die Sortierungen etwa gleich stark.`,
      /**
       * Reading text: often recognized categories.
       *
       * @param {string[]} cats Category labels.
       * @returns {string} Sentence.
       */
      recognized: (cats: string[]) =>
        `${listDe(cats)} ${cats.length === 1 ? 'wird' : 'werden'} häufig erkannt.`,
      /**
       * Reading text: hardly recognized categories.
       *
       * @param {string[]} cats Category labels.
       * @returns {string} Sentence.
       */
      hardly: (cats: string[]) =>
        `${listDe(cats)} ${cats.length === 1 ? 'wird' : 'werden'} kaum erkannt.`,
      /**
       * Reading text: how many submissions follow the deep-structure schema best.
       *
       * @param {number} count Submissions led by it.
       * @param {number} total Submissions with a lead value.
       * @param {string} schema Schema label.
       * @returns {string} Sentence.
       */
      split: (count: number, total: number, schema: string) =>
        `Bei ${count} von ${total} ${total === 1 ? 'Abgabe' : 'Abgaben'} liegt die Sortierung nach ${schema} vorn.`,
    },

    charts: {
      viewLabel: 'Darstellung',
      views: {
        graph: 'Karten-Graph',
        heatmap: 'Heatmap',
        dendrogram: 'Dendrogramm',
        categories: 'Trefferquoten',
      },
      schema: 'Referenzschema',
      graphHelp:
        'Je näher zwei Karten beieinanderliegen, desto öfter wurden sie in dieselbe Gruppe sortiert. Linien zeigen die stärksten Verbindungen.',
      graphEmpty:
        'Noch keine Kartenpaare zusammen gruppiert — sobald Abgaben vorliegen, erscheint hier der Graph.',
      graphAria: 'Kookkurrenz-Graph der Karten',
      heatmapHelp:
        'Anteil der Abgaben, in denen zwei Karten zusammen in einer Gruppe lagen. Umrandet: Karten derselben Kategorie des Referenzschemas.',
      heatmapHelpNoSchema:
        'Anteil der Abgaben, in denen zwei Karten zusammen in einer Gruppe lagen. Reihenfolge nach der Clusteranalyse.',
      /**
       * Info line of a selected heatmap cell.
       *
       * @param {string} a Card label.
       * @param {string} b Card label.
       * @param {string} pct Formatted share.
       * @param {number} count Submissions with both together.
       * @param {number} n All submissions.
       * @returns {string} Info text.
       */
      heatmapCell: (a: string, b: string, pct: string, count: number, n: number) =>
        `${a} und ${b}: ${pct} (${count} von ${n} ${n === 1 ? 'Abgabe' : 'Abgaben'})`,
      heatmapAria: 'Heatmap der Kookkurrenz-Anteile',
      scale: 'gemeinsam sortiert',
      dendroHelp:
        'Das Diagramm zeigt, welche Karten die Klasse als zusammengehörig ansieht: Links steht jede Karte für sich, nach rechts werden sie Schritt für Schritt zu immer größeren Gruppen zusammengefasst. Je weiter links zwei Zweige zusammenlaufen, desto öfter lagen die Karten zusammen. Gestrichelt: Was links davon zusammenläuft, lag im Mittel in mindestens der Hälfte der Abgaben zusammen.',
      dendroAxis: 'im Mittel gemeinsam sortiert',
      /**
       * Info line of a selected dendrogram merge.
       *
       * @param {string} pct Formatted mean share.
       * @param {string} cards Ids of the merged cards, comma-separated.
       * @returns {string} Info text.
       */
      dendroMerge: (pct: string, cards: string) => `Im Mittel ${pct} gemeinsam sortiert: ${cards}`,
      dendroAria: 'Dendrogramm der Karten',
      tapHint: 'Für Werte zeigen oder antippen.',
    },

    names: {
      search: 'Suche',
      searchPlaceholder: 'Name enthält …',
      cardFilter: 'Karte',
      allCards: 'Alle',
      /**
       * Summary above the group names.
       *
       * @param {number} names Distinct names.
       * @param {number} groups Named groups.
       * @returns {string} Summary.
       */
      summary: (names: number, groups: number) =>
        `${names} verschiedene Namen für ${groups} Gruppen. Schreibweisen, die sich nur in Groß-/Kleinschreibung oder Leerzeichen unterscheiden, sind zusammengefasst.`,
      /**
       * Heading when filtering names by card.
       *
       * @param {string} card Card label.
       * @returns {string} Heading.
       */
      forCard: (card: string) => `Namen der Gruppen, in denen ${card} lag:`,
      none: 'Keine Namen passen zum Filter.',
      /**
       * Frequency of a name.
       *
       * @param {number} n Occurrences.
       * @returns {string} E.g. "3×".
       */
      times: (n: number) => `${n}×`,
      /**
       * Other spellings of a name.
       *
       * @param {string} v Variants, comma-separated.
       * @returns {string} Note.
       */
      variants: (v: string) => `auch: ${v}`,
      /**
       * Tooltip: how often a card lay in groups of this name.
       *
       * @param {string} card Card label.
       * @param {number} n Occurrences.
       * @returns {string} Tooltip.
       */
      cardCount: (card: string, n: number) => `${card}: ${n}× unter diesem Namen`,
      /**
       * Number of submissions using a name.
       *
       * @param {number} n Submissions.
       * @returns {string} Label.
       */
      usedBy: (n: number) => `${n} ${n === 1 ? 'Abgabe' : 'Abgaben'}`,
      codingTitle: 'Automatische Vorkodierung — ungeprüft',
      codingHelp:
        'Grobe Zuordnung der Namen über Markerwörter (name-markers.json): Prozess, Anwendungsdomäne oder Darstellungsform. Nicht validiert — nur als erste Orientierung, Anteile beziehen sich auf alle Gruppen.',
      unclear: 'unklar',
    },

    subs: {
      distTitle: 'Verteilung der Abgaben',
      /**
       * Help text of the submission distribution.
       *
       * @param {string} deep Deep-structure schema label.
       * @returns {string} Help text.
       */
      distHelp: (deep: string) =>
        `Jeder Punkt ist eine Abgabe. Rechts der Mitte liegt sie näher an der Sortierung nach ${deep}, links näher an einem Oberflächenmerkmal.`,
      left: 'näher an Oberflächenmerkmalen',
      /**
       * Right axis end of the distribution.
       *
       * @param {string} deep Deep-structure schema label.
       * @returns {string} Label.
       */
      right: (deep: string) => `näher an ${deep}`,
      axis: 'Unterschied in Prozentpunkten',
      /**
       * Info line of a selected dot: the submission fits one schema better.
       *
       * @param {number} no Submission number.
       * @param {string} closer Label of the closer schema.
       * @param {string} closerPct Its formatted agreement.
       * @param {string} other Label of the other schema.
       * @param {string} otherPct Its formatted agreement.
       * @param {string} diff Formatted difference in points.
       * @returns {string} Info text.
       */
      dotInfo: (no: number, closer: string, closerPct: string, other: string, otherPct: string, diff: string) =>
        `Abgabe ${no} passt besser zur Sortierung nach ${closer} (${closerPct}) als zu der nach ${other} (${otherPct}): ${diff} Prozentpunkte Unterschied.`,
      /**
       * Info line of a selected dot: the submission fits both schemas equally.
       *
       * @param {number} no Submission number.
       * @param {string} a Schema label.
       * @param {string} b Schema label.
       * @param {string} pct Formatted agreement.
       * @returns {string} Info text.
       */
      dotInfoTie: (no: number, a: string, b: string, pct: string) =>
        `Abgabe ${no} passt gleich gut zur Sortierung nach ${a} und nach ${b} (je ${pct}).`,
      dotAria: 'Punktdiagramm des Scores je Abgabe',
      open: 'Abgabe öffnen',
      tableTitle: 'Alle Abgaben',
      tableHelp: 'Zeile antippen, um die Abgabe zu öffnen. Spaltenköpfe sortieren die Tabelle.',
      columns: 'Spalten',
      col: {
        no: 'Nr.',
        time: 'Zeitpunkt',
        groups: 'Gruppen',
        studentId: 'Schüler:innen-ID',
        best: 'am nächsten an',
        lead: 'Score',
        lang: 'Sprache',
      },
      /**
       * Column header of the ARI against a schema.
       *
       * @param {string} schema Schema label.
       * @returns {string} Header.
       */
      ari: (schema: string) => `ARI ${schema}`,
      /**
       * Explanation of the score column.
       *
       * @param {string} deep Deep-structure schema label.
       * @returns {string} Help text.
       */
      leadHelp: (deep: string) =>
        `Score: Übereinstimmung mit der Sortierung nach ${deep} minus höchste Übereinstimmung mit einem Oberflächenmerkmal, in Prozentpunkten. Positiv = näher an ${deep}.`,
      /**
       * Title of the submission detail overlay.
       *
       * @param {number} no Submission number.
       * @returns {string} Title.
       */
      detailTitle: (no: number) => `Abgabe ${no}`,
      close: 'Schließen',
      sorting: 'Sortierung',
      unnamed: '(ohne Namen)',
      ungrouped: 'ohne Gruppe',
      notPlaced: 'nicht abgelegt',
      /**
       * Note on the category dots of the cards.
       *
       * @param {string} schema Schema label.
       * @returns {string} Note.
       */
      colorNote: (schema: string) => `Farbpunkt an der Karte: Kategorie nach ${schema}.`,
    },
  },
}

/** Dictionary contract of all languages. */
export type Dict = typeof de
