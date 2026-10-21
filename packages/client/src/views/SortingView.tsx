import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import '../App.css'
import cardsData from '@sortiertool/shared/cards.json'
import type {
  CardPlacement,
  CardSource,
  Group,
  GroupInteractionMode,
  Rect,
  ResizeDir,
  SortState,
} from '../lib/types'
import { localizeCards } from '../lib/cards'
import { LANGS, useLang } from '../lib/i18n'
import { CARD_SIZE, GROUP_COLORS, MIN_FRAME_SIZE, SOURCE_URL, WORLD } from '../lib/config'
import { ApiError, getSession, submitSorting } from '../lib/api'
import { clearReceipt, getReceipt, setReceipt } from '../lib/receipt'
import { clearDraft, loadDraft, saveDraft } from '../lib/draft'
import { DEFAULT_SESSION_KEY } from '@sortiertool/shared/constants'
import { toRelativeState } from '../lib/relative'
import { Canvas } from '../components/Canvas'

/**
 * Coordinates: cards and frames live in world px ({@link WORLD}); the screen shows them via
 * {@link View}, pointers map back with `toWorld`. Pointer modes: card drag/tap (`beginDrag`),
 * frame drawing (`beginFrameDraw`), frame move/resize (`beginGroupInteraction`), plus pan/pinch.
 * Group assignment is geometric and live ({@link groupAt}); the state is autosaved as a draft
 * and submitted in relative coordinates.
 */

/** Card set in file order; also the order of the stack. */
const cardSources = cardsData as CardSource[]
/** Card ids of the current set; guard against drafts saved for another set (`lib/draft.ts`). */
const CARD_IDS = cardSources.map((c) => c.id)

/** Debounce of the draft autosave, in ms. */
const DRAFT_SAVE_DELAY = 600

/** Pointer travel in screen px after which a press on a card becomes a drag instead of a tap. */
const DRAG_THRESHOLD = 5

/**
 * Zoom limits and step. The minimum is dynamic ({@link fitScaleFor}): whole board visible,
 * scaled by `FIT_MARGIN`. `ZOOM_STEP` is the factor per button/key press.
 */
const MAX_SCALE = 3.5
const FIT_MARGIN = 0.92
const ZOOM_STEP = 1.25

/**
 * Target on-screen card edge as a fraction of the shorter viewport side, clamped in px.
 * Drives the start zoom and the UI scale so stack and placed cards look the same size.
 */
const CARD_TARGET_FRACTION = 0.12
const CARD_TARGET_MIN = 44
const CARD_TARGET_MAX = 96

/** Lower bound of the button scaling, so touch targets stay usable. */
const CHROME_MIN_SCALE = 0.82

/**
 * A running press on a card (drag or tap).
 *
 * @property {string} cardId Pressed card.
 * @property {boolean} fromStack Whether the card was pulled from the stack (never a tap).
 * @property {number} startClientX Pointer x at press, screen px.
 * @property {number} startClientY Pointer y at press, screen px.
 * @property {number} grabX Offset pointer ↔ card corner, world px.
 * @property {number} grabY Offset pointer ↔ card corner, world px.
 * @property {boolean} dragging Whether `DRAG_THRESHOLD` was exceeded.
 */
interface Interaction {
  cardId: string
  fromStack: boolean
  startClientX: number
  startClientY: number
  grabX: number
  grabY: number
  dragging: boolean
}

/**
 * A running move or resize of a frame.
 *
 * @property {string} groupId Affected group.
 * @property {GroupInteractionMode} mode `'move'` or the dragged edge/corner.
 * @property {number} startX Pointer x at press, world px.
 * @property {number} startY Pointer y at press, world px.
 * @property {Rect} orig Frame rectangle at press.
 * @property {{ cardId: string; x: number; y: number }[]} [members] Move only: start positions
 *   of the contained cards, which move along.
 */
interface GroupInteraction {
  groupId: string
  mode: GroupInteractionMode
  startX: number
  startY: number
  orig: Rect
  members?: { cardId: string; x: number; y: number }[]
}

/**
 * Viewport transform: `screen = world · scale + pan` (origin top left).
 *
 * @property {number} scale Zoom factor.
 * @property {number} panX Horizontal offset, screen px.
 * @property {number} panY Vertical offset, screen px.
 */
interface View {
  scale: number
  panX: number
  panY: number
}

/**
 * Start values of a two-finger pinch.
 *
 * @property {number} startDist Finger distance at start, screen px.
 * @property {number} startMidX Midpoint x at start, client px.
 * @property {number} startMidY Midpoint y at start, client px.
 * @property {number} startScale View scale at start.
 * @property {number} startPanX View pan x at start.
 * @property {number} startPanY View pan y at start.
 */
interface Gesture {
  startDist: number
  startMidX: number
  startMidY: number
  startScale: number
  startPanX: number
  startPanY: number
}

/**
 * Start values of a right-button mouse pan.
 *
 * @property {number} clientX Pointer x at press.
 * @property {number} clientY Pointer y at press.
 * @property {number} panX View pan x at press.
 * @property {number} panY View pan y at press.
 */
interface PanStart {
  clientX: number
  clientY: number
  panX: number
  panY: number
}

/**
 * @property {string} sessionKey Session the sorting is submitted to.
 */
interface SortingViewProps {
  sessionKey: string
}

/**
 * Session information including whether student ID is required.
 */
interface SessionInfo {
  status: 'open' | 'closed'
  cardSetVersion: string
  requiresStudentId: boolean
}

/**
 * Start state: every card still on the stack, ungrouped.
 *
 * @returns {CardPlacement[]} One placement per card of the set.
 */
function initialPlacements(): CardPlacement[] {
  return CARD_IDS.map((id) => ({ cardId: id, onCanvas: false, x: 0, y: 0, groupId: null }))
}

/**
 * Clamps a value to `[0, max]`.
 *
 * @param {number} value Value to clamp.
 * @param {number} max Upper bound.
 * @returns {number} Clamped value.
 */
function clamp(value: number, max: number) {
  return Math.max(0, Math.min(value, max))
}

/**
 * Clamps one pan axis so the board stays flush with the viewport edges; centers it when it is
 * smaller than the viewport.
 *
 * @param {number} pan Requested pan, screen px.
 * @param {number} contentPx Board size on screen along this axis.
 * @param {number} viewportSize Viewport size along this axis.
 * @returns {number} Allowed pan.
 */
function clampPanAxis(pan: number, contentPx: number, viewportSize: number) {
  if (contentPx <= viewportSize) return (viewportSize - contentPx) / 2
  return Math.min(0, Math.max(viewportSize - contentPx, pan))
}

/**
 * Scale at which the whole board fits into the viewport (minus `FIT_MARGIN`): the minimum zoom.
 *
 * @param {number} viewportW Viewport width.
 * @param {number} viewportH Viewport height.
 * @returns {number} Fit scale.
 */
function fitScaleFor(viewportW: number, viewportH: number) {
  return Math.min(viewportW / WORLD.width, viewportH / WORLD.height) * FIT_MARGIN
}

/**
 * Target on-screen card edge for this viewport.
 *
 * @param {number} viewportW Viewport width.
 * @param {number} viewportH Viewport height.
 * @returns {number} Card edge in screen px, within `[CARD_TARGET_MIN, CARD_TARGET_MAX]`.
 */
function uiCardPx(viewportW: number, viewportH: number) {
  const target = Math.min(viewportW, viewportH) * CARD_TARGET_FRACTION
  return Math.min(CARD_TARGET_MAX, Math.max(CARD_TARGET_MIN, target))
}

/**
 * UI scale for stack and buttons, matching the size of placed cards at start zoom.
 *
 * @param {number} viewportW Viewport width.
 * @param {number} viewportH Viewport height.
 * @returns {number} Scale; `1` = cards at world size (`CARD_SIZE`).
 */
function uiScaleFor(viewportW: number, viewportH: number) {
  return uiCardPx(viewportW, viewportH) / CARD_SIZE
}

/**
 * Start view: cards at their target size, board centered, zoom within its limits.
 *
 * @param {number} viewportW Viewport width.
 * @param {number} viewportH Viewport height.
 * @returns {View} Initial viewport transform.
 */
function defaultView(viewportW: number, viewportH: number): View {
  const wanted = uiScaleFor(viewportW, viewportH)
  const scale = Math.min(Math.max(wanted, fitScaleFor(viewportW, viewportH)), MAX_SCALE)
  return {
    scale,
    panX: (viewportW - WORLD.width * scale) / 2,
    panY: (viewportH - WORLD.height * scale) / 2,
  }
}

/**
 * Normalized rectangle spanned by two corner points, in any order.
 *
 * @param {number} ax First point x.
 * @param {number} ay First point y.
 * @param {number} bx Second point x.
 * @param {number} by Second point y.
 * @returns {Rect} Rectangle with non-negative size.
 */
function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(ax - bx),
    height: Math.abs(ay - by),
  }
}

/**
 * Whether two rectangles overlap; touching edges do not count.
 *
 * @param {Rect} a First rectangle.
 * @param {Rect} b Second rectangle.
 * @returns {boolean} `true` on a real overlap.
 */
function rectsOverlap(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/**
 * Size of the board in world px.
 *
 * @property {number} width Board width.
 * @property {number} height Board height.
 */
type WorldSize = { width: number; height: number }

/**
 * Shifts a frame by a delta, keeping it inside the board.
 *
 * @param {Rect} orig Frame at the start of the move.
 * @param {number} dx Horizontal delta, world px.
 * @param {number} dy Vertical delta, world px.
 * @param {WorldSize} world Board size.
 * @returns {Rect} Moved frame.
 */
function moveRect(orig: Rect, dx: number, dy: number, world: WorldSize): Rect {
  return {
    x: clamp(orig.x + dx, world.width - orig.width),
    y: clamp(orig.y + dy, world.height - orig.height),
    width: orig.width,
    height: orig.height,
  }
}

/**
 * Resizes a frame by dragging an edge or corner, respecting `MIN_FRAME_SIZE` and the board.
 *
 * @param {Rect} orig Frame at the start of the resize.
 * @param {ResizeDir} dir Dragged edge/corner (compass letters).
 * @param {number} dx Horizontal delta, world px.
 * @param {number} dy Vertical delta, world px.
 * @param {WorldSize} world Board size.
 * @returns {Rect} Resized frame; the opposite edge stays fixed.
 */
function resizeRect(
  orig: Rect,
  dir: ResizeDir,
  dx: number,
  dy: number,
  world: WorldSize,
): Rect {
  let { x, y, width, height } = orig
  if (dir.includes('e')) width = orig.width + dx
  if (dir.includes('s')) height = orig.height + dy
  if (dir.includes('w')) {
    width = orig.width - dx
    x = orig.x + dx
  }
  if (dir.includes('n')) {
    height = orig.height - dy
    y = orig.y + dy
  }
  // For west/north, keep the opposite edge pinned.
  if (width < MIN_FRAME_SIZE) {
    if (dir.includes('w')) x = orig.x + orig.width - MIN_FRAME_SIZE
    width = MIN_FRAME_SIZE
  }
  if (height < MIN_FRAME_SIZE) {
    if (dir.includes('n')) y = orig.y + orig.height - MIN_FRAME_SIZE
    height = MIN_FRAME_SIZE
  }
  if (x < 0) {
    width += x
    x = 0
  }
  if (y < 0) {
    height += y
    y = 0
  }
  if (x + width > world.width) width = world.width - x
  if (y + height > world.height) height = world.height - y
  width = Math.max(MIN_FRAME_SIZE, width)
  height = Math.max(MIN_FRAME_SIZE, height)
  return { x, y, width, height }
}

/**
 * Geometric group assignment: the group whose frame contains the card's center.
 *
 * Should frames ever overlap, the most recently created one wins.
 *
 * @param {number} x Card x (top left), world px.
 * @param {number} y Card y (top left), world px.
 * @param {Group[]} groups Frames in creation order.
 * @returns {string | null} Group id, or `null` (grey, ungrouped).
 */
function groupAt(x: number, y: number, groups: Group[]): string | null {
  const cx = x + CARD_SIZE / 2
  const cy = y + CARD_SIZE / 2
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height) {
      return g.id
    }
  }
  return null
}

/**
 * Age of a saved draft, for the resume question.
 *
 * @param {string} savedAt ISO timestamp.
 * @returns {number} Age in whole minutes.
 */
function ageInMinutes(savedAt: string): number {
  return Math.round((Date.now() - Date.parse(savedAt)) / 60000)
}

/**
 * Renders the sorting view: task bar with menu and help, canvas with stack and frames, zoom
 * controls, submit and hand-over actions, and the resume dialog for a stored draft.
 *
 * @param {SortingViewProps} props Component props.
 * @param {string} props.sessionKey Session the sorting is submitted to.
 * @returns {JSX.Element} The sorting view.
 */
export function SortingView({ sessionKey }: SortingViewProps) {
  const { lang, setLang, t } = useLang()
  const cards = useMemo(() => localizeCards(cardSources, lang), [lang])
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(sessionKey === DEFAULT_SESSION_KEY ? { status: 'open', cardSetVersion: '1', requiresStudentId: false } : null)
  const [sessionLoading, setSessionLoading] = useState(sessionKey !== DEFAULT_SESSION_KEY)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [studentId, setStudentId] = useState('')
  const [showStudentIdModal, setShowStudentIdModal] = useState(false)

  // Lazy initializer instead of an effect: otherwise the empty start state would render first
  // and the autosave could write it over the stored draft.
  const [restored] = useState(() => loadDraft(sessionKey, CARD_IDS))

  // Fetch session info on mount
  useEffect(() => {
    const fetchSessionInfo = async () => {
      try {
        const info = await getSession(sessionKey)
        setSessionInfo(info)
      } catch {
        setSessionError('Session not found')
      } finally {
        setSessionLoading(false)
      }
    }
    fetchSessionInfo()
  }, [sessionKey])

  const [placements, setPlacements] = useState<CardPlacement[]>(
    () => restored?.placements ?? initialPlacements(),
  )
  const [groups, setGroups] = useState<Group[]>(() => restored?.groups ?? [])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Opened by tap, at most one.
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  // Pinned cards stay open, any number of them.
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => restored?.pinnedIds ?? [])
  // Z-order, frontmost last.
  const [frontOrder, setFrontOrder] = useState<string[]>(() => restored?.frontOrder ?? [])
  const [draftFrame, setDraftFrame] = useState<Rect | null>(null)
  const [submitMsg, setSubmitMsg] = useState<{
    text: string
    kind: 'error' | 'success'
  } | null>(null)
  const [unnamedGroupIds, setUnnamedGroupIds] = useState<string[]>([])
  // 'confirm' = asking before the reset.
  const [handover, setHandover] = useState<'none' | 'offer' | 'confirm'>('none')
  const [resumeAsk, setResumeAsk] = useState(restored !== null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpHover, setHelpHover] = useState(false)
  const [helpPinned, setHelpPinned] = useState(false)
  const helpOpen = helpHover || helpPinned

  // Set by a touch pointerdown on the help button, so the following click doesn't toggle again.
  const helpToggledRef = useRef(false)

  /**
   * Closes the help popover, whether opened by hover or pinned.
   *
   * @returns {void}
   */
  const closeHelp = useCallback(() => {
    setHelpHover(false)
    setHelpPinned(false)
  }, [])

  /**
   * Pins the help popover open, or closes it if already pinned.
   *
   * @returns {void}
   */
  const toggleHelpPin = useCallback(() => {
    if (helpPinned) closeHelp()
    else setHelpPinned(true)
  }, [helpPinned, closeHelp])
  // Estimated from the window size; the init effect refines it with the canvas size.
  const [view, setView] = useState<View>(() => defaultView(window.innerWidth, window.innerHeight))
  // State rather than derived, so rendering never reads viewportRef.
  const [minScale, setMinScale] = useState(() =>
    fitScaleFor(window.innerWidth, window.innerHeight),
  )

  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef({ width: window.innerWidth, height: window.innerHeight })
  const interactionRef = useRef<Interaction | null>(null)
  // Mirror refs for stable callbacks. Only read in event handlers, so syncing after commit is
  // enough.
  const groupsRef = useRef(groups)
  const placementsRef = useRef(placements)
  const pinnedRef = useRef(pinnedIds)
  const frontOrderRef = useRef(frontOrder)
  const viewRef = useRef(view)
  const resumeAskRef = useRef(resumeAsk)
  useEffect(() => {
    groupsRef.current = groups
    placementsRef.current = placements
    pinnedRef.current = pinnedIds
    frontOrderRef.current = frontOrder
    viewRef.current = view
    resumeAskRef.current = resumeAsk
  }, [groups, placements, pinnedIds, frontOrder, view, resumeAsk])

  // Touch/pen pointers only.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const gestureRef = useRef<Gesture | null>(null)
  const gestureAbortRef = useRef<AbortController | null>(null)
  const panStartRef = useRef<PanStart | null>(null)
  const panAbortRef = useRef<AbortController | null>(null)
  const frameStartRef = useRef<{ x: number; y: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const frameAbortRef = useRef<AbortController | null>(null)
  const groupInteractionRef = useRef<GroupInteraction | null>(null)
  const groupAbortRef = useRef<AbortController | null>(null)
  const msgTimerRef = useRef<number | null>(null)

  // --- Draft autosave (lib/draft.ts) ----------------------------------------------------
  useEffect(() => {
    // No saving while the resume question is open: it would only refresh the timestamp and
    // thus extend the expiry of someone else's draft.
    if (resumeAsk) return
    const t = window.setTimeout(() => {
      // An untouched board clears the storage instead of writing an empty draft — otherwise the
      // reset of "Done — next person" would immediately write one back.
      if (groups.length === 0 && placements.every((p) => !p.onCanvas)) clearDraft(sessionKey)
      else saveDraft(sessionKey, { placements, groups, pinnedIds, frontOrder }, CARD_IDS)
    }, DRAFT_SAVE_DELAY)
    return () => window.clearTimeout(t)
  }, [sessionKey, placements, groups, pinnedIds, frontOrder, resumeAsk])

  // Immediate save when the page is hidden: iOS recycles the tab after screen lock before the
  // debounce above fires, and `beforeunload` is unreliable there.
  useEffect(() => {
    /**
     * Saves the current state from the mirror refs right away.
     *
     * @returns {void}
     */
    const flush = () => {
      // See the autosave effect above.
      if (resumeAskRef.current) return
      const placements = placementsRef.current
      if (groupsRef.current.length === 0 && placements.every((p) => !p.onCanvas)) return
      saveDraft(
        sessionKey,
        {
          placements,
          groups: groupsRef.current,
          pinnedIds: pinnedRef.current,
          frontOrder: frontOrderRef.current,
        },
        CARD_IDS,
      )
    }
    /**
     * Flushes the draft when the page becomes hidden.
     *
     * @returns {void}
     */
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sessionKey])

  /**
   * Minimum zoom for the current viewport.
   *
   * @returns {number} Fit scale, see {@link fitScaleFor}.
   */
  const fitScale = useCallback(() => {
    const vp = viewportRef.current
    return fitScaleFor(vp.width, vp.height)
  }, [])

  /**
   * Clamps a zoom factor to `[fitScale, MAX_SCALE]`.
   *
   * @param {number} scale Requested scale.
   * @returns {number} Allowed scale.
   */
  const clampScale = useCallback(
    (scale: number) => {
      const min = fitScale()
      return Math.max(min, Math.min(Math.max(min, MAX_SCALE), scale))
    },
    [fitScale],
  )

  /**
   * Clamps a pan on both axes for the given scale, see {@link clampPanAxis}.
   *
   * @param {number} panX Requested pan x.
   * @param {number} panY Requested pan y.
   * @param {number} scale Scale the pan applies to.
   * @returns {{ x: number; y: number }} Allowed pan.
   */
  const clampPan = useCallback((panX: number, panY: number, scale: number) => {
    const vp = viewportRef.current
    return {
      x: clampPanAxis(panX, WORLD.width * scale, vp.width),
      y: clampPanAxis(panY, WORLD.height * scale, vp.height),
    }
  }, [])

  // Viewport tracking: measures the canvas, sets the CSS UI scales, sets the start view once and
  // re-clamps the view on every resize.
  const initedRef = useRef(false)
  useEffect(() => {
    /**
     * Re-measures the viewport and adapts UI scales and view to it.
     *
     * @returns {void}
     */
    const update = () => {
      const el = canvasRef.current
      viewportRef.current = el
        ? { width: el.clientWidth, height: el.clientHeight }
        : { width: window.innerWidth, height: window.innerHeight }
      const vp = viewportRef.current
      setMinScale(fitScaleFor(vp.width, vp.height))
      const ui = uiScaleFor(vp.width, vp.height)
      const root = document.documentElement.style
      root.setProperty('--ui-scale', String(ui))
      root.setProperty('--chrome-scale', String(Math.min(1, Math.max(CHROME_MIN_SCALE, ui))))
      if (!initedRef.current) {
        initedRef.current = true
        setView(defaultView(vp.width, vp.height))
        return
      }
      setView((v) => {
        const scale = clampScale(v.scale)
        const p = clampPan(v.panX, v.panY, scale)
        return scale === v.scale && p.x === v.panX && p.y === v.panY
          ? v
          : { scale, panX: p.x, panY: p.y }
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [clampScale, clampPan])

  /**
   * Maps a client (screen) position to world coordinates under the current view.
   *
   * @param {number} clientX Pointer x, client px.
   * @param {number} clientY Pointer y, client px.
   * @returns {{ x: number; y: number }} Position in world px.
   */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { scale, panX, panY } = viewRef.current
    return {
      x: (clientX - rect.left - panX) / scale,
      y: (clientY - rect.top - panY) / scale,
    }
  }, [])

  // --- Zoom & pan (viewport) ----------------------------------------------

  /**
   * Zooms by a factor while the world point under the pointer/finger stays in place.
   *
   * @param {number} clientX Zoom anchor x, client px.
   * @param {number} clientY Zoom anchor y, client px.
   * @param {number} factor Relative zoom factor (`> 1` zooms in).
   * @returns {void}
   */
  const zoomAround = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = clientX - rect.left
      const cy = clientY - rect.top
      setView((v) => {
        const scale = clampScale(v.scale * factor)
        if (scale === v.scale) return v
        const wx = (cx - v.panX) / v.scale
        const wy = (cy - v.panY) / v.scale
        const p = clampPan(cx - wx * scale, cy - wy * scale, scale)
        return { scale, panX: p.x, panY: p.y }
      })
    },
    [clampPan, clampScale],
  )

  /**
   * Zooms around the canvas center (buttons, keyboard).
   *
   * @param {number} factor Relative zoom factor.
   * @returns {void}
   */
  const zoomToCenter = useCallback(
    (factor: number) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
    },
    [zoomAround],
  )

  /**
   * Resets the zoom to 100 % around the canvas center.
   *
   * @returns {void}
   */
  const resetView = useCallback(() => {
    zoomToCenter(1 / viewRef.current.scale)
  }, [zoomToCenter])

  /**
   * Aborts any running card drag, frame drawing and frame move/resize, e.g. when a pinch starts.
   *
   * @returns {void}
   */
  const cancelInteractions = useCallback(() => {
    interactionRef.current = null
    setDraggingId(null)
    abortRef.current?.abort()
    abortRef.current = null
    frameStartRef.current = null
    setDraftFrame(null)
    frameAbortRef.current?.abort()
    frameAbortRef.current = null
    groupInteractionRef.current = null
    groupAbortRef.current?.abort()
    groupAbortRef.current = null
  }, [])

  /**
   * Mouse pan: follows the pointer from the pan start.
   *
   * @param {PointerEvent} e Window pointer move.
   * @returns {void}
   */
  const handlePanMove = useCallback(
    (e: PointerEvent) => {
      const s = panStartRef.current
      if (!s) return
      const p = clampPan(
        s.panX + (e.clientX - s.clientX),
        s.panY + (e.clientY - s.clientY),
        viewRef.current.scale,
      )
      setView((v) => ({ ...v, panX: p.x, panY: p.y }))
    },
    [clampPan],
  )

  /**
   * Ends the mouse pan and removes its listeners.
   *
   * @returns {void}
   */
  const handlePanUp = useCallback(() => {
    panStartRef.current = null
    panAbortRef.current?.abort()
    panAbortRef.current = null
  }, [])

  /**
   * Starts a mouse pan (right button) and registers its window listeners.
   *
   * @param {ReactPointerEvent} e Pointer down on the canvas.
   * @returns {void}
   */
  const beginPan = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      const v = viewRef.current
      panStartRef.current = { clientX: e.clientX, clientY: e.clientY, panX: v.panX, panY: v.panY }
      panAbortRef.current?.abort()
      const controller = new AbortController()
      panAbortRef.current = controller
      const { signal } = controller
      window.addEventListener('pointermove', handlePanMove, { signal })
      window.addEventListener('pointerup', handlePanUp, { signal })
      window.addEventListener('pointercancel', handlePanUp, { signal })
    },
    [handlePanMove, handlePanUp],
  )

  /**
   * Two-finger gesture: pinch zoom (finger distance) and pan (midpoint) at once.
   *
   * The world point under the start midpoint is kept under the current midpoint.
   *
   * @param {PointerEvent} e Window pointer move of one of the fingers.
   * @returns {void}
   */
  const handleGestureMove = useCallback(
    (e: PointerEvent) => {
      const pts = pointersRef.current
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const g = gestureRef.current
      if (!g || pts.size < 2) return
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const [a, b] = [...pts.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const scale = clampScale(g.startScale * (dist / g.startDist))
      const wx = (g.startMidX - rect.left - g.startPanX) / g.startScale
      const wy = (g.startMidY - rect.top - g.startPanY) / g.startScale
      const p = clampPan(midX - rect.left - wx * scale, midY - rect.top - wy * scale, scale)
      setView({ scale, panX: p.x, panY: p.y })
    },
    [clampPan, clampScale],
  )

  /**
   * Ends the two-finger gesture and removes its listener.
   *
   * @returns {void}
   */
  const endGesture = useCallback(() => {
    gestureRef.current = null
    gestureAbortRef.current?.abort()
    gestureAbortRef.current = null
  }, [])

  /**
   * Starts a two-finger gesture from the two tracked pointers; cancels any other interaction.
   *
   * @returns {void}
   */
  const startGesture = useCallback(() => {
    const pts = [...pointersRef.current.values()]
    if (pts.length < 2) return
    cancelInteractions()
    const [a, b] = pts
    const v = viewRef.current
    gestureRef.current = {
      startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      startMidX: (a.x + b.x) / 2,
      startMidY: (a.y + b.y) / 2,
      startScale: v.scale,
      startPanX: v.panX,
      startPanY: v.panY,
    }
    gestureAbortRef.current?.abort()
    const controller = new AbortController()
    gestureAbortRef.current = controller
    window.addEventListener('pointermove', handleGestureMove, { signal: controller.signal })
  }, [cancelInteractions, handleGestureMove])

  /**
   * Viewport-level pointer down (bubbles up after the card, frame and background handlers):
   * starts a mouse pan on the right button, tracks touch/pen pointers and starts the pinch at the
   * second finger.
   *
   * Also blurs a focused name field explicitly: the `preventDefault()` of the drag interactions
   * suppresses the browser's focus change, and on tablets the keyboard would stay open. The
   * name field and the delete button stop their own pointerdown, so they never reach this.
   *
   * @param {ReactPointerEvent} e Pointer down on the canvas.
   * @returns {void}
   */
  const handleCanvasPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        active.blur()
      }
      if (e.pointerType === 'mouse') {
        if (e.button === 2) beginPan(e)
        return
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointersRef.current.size === 2) startGesture()
    },
    [beginPan, startGesture],
  )

  // Wheel zoom on the canvas (non-passive, to suppress page scroll) and keyboard shortcuts.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    /**
     * Zooms around the pointer, smoothly proportional to the wheel delta.
     *
     * @param {WheelEvent} e Wheel event on the canvas.
     * @returns {void}
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAround(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    /**
     * Escape closes help and menu; Ctrl/Cmd `+`, `-`, `0` zoom in, out and reset.
     *
     * @param {KeyboardEvent} e Window key down.
     * @returns {void}
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeHelp()
        setMenuOpen(false)
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomToCenter(ZOOM_STEP)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomToCenter(1 / ZOOM_STEP)
      } else if (e.key === '0') {
        e.preventDefault()
        resetView()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [zoomAround, zoomToCenter, resetView, closeHelp])

  // The gesture ends as soon as fewer than two fingers are down.
  useEffect(() => {
    /**
     * Forgets a lifted pointer and ends the gesture below two pointers.
     *
     * @param {PointerEvent} e Window pointer up/cancel.
     * @returns {void}
     */
    const remove = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      if (gestureRef.current && pointersRef.current.size < 2) endGesture()
    }
    window.addEventListener('pointerup', remove)
    window.addEventListener('pointercancel', remove)
    return () => {
      window.removeEventListener('pointerup', remove)
      window.removeEventListener('pointercancel', remove)
    }
  }, [endGesture])

  /**
   * Moves a card (clamped to the board) and reassigns its group from the new position.
   *
   * @param {string} cardId Card to move.
   * @param {number} x New x (top left), world px.
   * @param {number} y New y (top left), world px.
   * @returns {void}
   */
  const setPosition = useCallback((cardId: string, x: number, y: number) => {
    setPlacements((prev) =>
      prev.map((p) => {
        if (p.cardId !== cardId) return p
        const nx = clamp(x, WORLD.width - CARD_SIZE)
        const ny = clamp(y, WORLD.height - CARD_SIZE)
        return { ...p, x: nx, y: ny, groupId: groupAt(nx, ny, groupsRef.current) }
      }),
    )
  }, [])

  /**
   * Closes the tap-opened card and the menu (click elsewhere).
   *
   * @returns {void}
   */
  const closeOpen = useCallback(() => {
    setOpenCardId(null)
    setMenuOpen(false)
  }, [])

  /**
   * Moves a card to the top of the z-order.
   *
   * @param {string} cardId Card to raise.
   * @returns {void}
   */
  const bringToFront = useCallback((cardId: string) => {
    setFrontOrder((prev) =>
      prev[prev.length - 1] === cardId
        ? prev
        : [...prev.filter((id) => id !== cardId), cardId],
    )
  }, [])

  /**
   * Pins or unpins a card (pinned cards stay open).
   *
   * @param {string} cardId Card to toggle.
   * @returns {void}
   */
  const togglePin = useCallback((cardId: string) => {
    setPinnedIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    )
  }, [])

  /**
   * Recomputes the group of every placed card against a new set of frames.
   *
   * @param {Group[]} nextGroups Frames after the change.
   * @returns {void}
   */
  const reassignAll = useCallback((nextGroups: Group[]) => {
    setPlacements((prev) =>
      prev.map((p) =>
        p.onCanvas ? { ...p, groupId: groupAt(p.x, p.y, nextGroups) } : p,
      ),
    )
  }, [])

  // --- Card drag / open ---------------------------------------------

  /**
   * Card pointer move: turns the press into a drag after `DRAG_THRESHOLD`, then follows the
   * pointer.
   *
   * @param {PointerEvent} e Window pointer move.
   * @returns {void}
   */
  const handleMove = useCallback(
    (e: PointerEvent) => {
      const it = interactionRef.current
      if (!it) return
      if (!it.dragging) {
        const dx = e.clientX - it.startClientX
        const dy = e.clientY - it.startClientY
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        it.dragging = true
        setDraggingId(it.cardId)
      }
      const world = toWorld(e.clientX, e.clientY)
      setPosition(it.cardId, world.x - it.grabX, world.y - it.grabY)
    },
    [toWorld, setPosition],
  )

  /**
   * Card pointer up: a press without drag (and not from the stack) is a tap and toggles the
   * card open — unless it is pinned. Removes the listeners.
   *
   * @returns {void}
   */
  const handleUp = useCallback(() => {
    const it = interactionRef.current
    if (it && !it.dragging && !it.fromStack) {
      const id = it.cardId
      if (!pinnedRef.current.includes(id)) {
        setOpenCardId((prev) => (prev === id ? null : id))
      }
    }
    interactionRef.current = null
    setDraggingId(null)
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /**
   * Starts a press on a card. A card from the stack is placed under the pointer and dragged
   * immediately; a placed card only becomes a drag once it moves (otherwise a tap).
   *
   * @param {string} cardId Pressed card.
   * @param {ReactPointerEvent} e Pointer down on the card.
   * @param {boolean} fromStack Whether the card is the top card of the stack.
   * @returns {void}
   */
  const beginDrag = useCallback(
    (cardId: string, e: ReactPointerEvent, fromStack: boolean) => {
      // The right mouse button belongs to the canvas pan.
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      bringToFront(cardId)
      const world = toWorld(e.clientX, e.clientY)

      if (fromStack) {
        const x = clamp(world.x - CARD_SIZE / 2, WORLD.width - CARD_SIZE)
        const y = clamp(world.y - CARD_SIZE / 2, WORLD.height - CARD_SIZE)
        setPlacements((prev) =>
          prev.map((p) =>
            p.cardId === cardId
              ? { ...p, onCanvas: true, x, y, groupId: groupAt(x, y, groupsRef.current) }
              : p,
          ),
        )
        interactionRef.current = {
          cardId,
          fromStack: true,
          startClientX: e.clientX,
          startClientY: e.clientY,
          grabX: world.x - x,
          grabY: world.y - y,
          dragging: true,
        }
        setDraggingId(cardId)
      } else {
        const p = placements.find((pl) => pl.cardId === cardId)!
        interactionRef.current = {
          cardId,
          fromStack: false,
          startClientX: e.clientX,
          startClientY: e.clientY,
          grabX: world.x - p.x,
          grabY: world.y - p.y,
          dragging: false,
        }
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const { signal } = controller
      window.addEventListener('pointermove', handleMove, { signal })
      window.addEventListener('pointerup', handleUp, { signal })
      window.addEventListener('pointercancel', handleUp, { signal })
    },
    [toWorld, placements, handleMove, handleUp, bringToFront],
  )

  // --- Frame drawing ---------------------------------------------------

  /**
   * Updates the draft frame between the start point and the pointer.
   *
   * @param {PointerEvent} e Window pointer move.
   * @returns {void}
   */
  const handleFrameMove = useCallback(
    (e: PointerEvent) => {
      const start = frameStartRef.current
      if (!start) return
      const cur = toWorld(e.clientX, e.clientY)
      const cx = clamp(cur.x, WORLD.width)
      const cy = clamp(cur.y, WORLD.height)
      setDraftFrame(rectFromPoints(start.x, start.y, cx, cy))
    },
    [toWorld],
  )

  /**
   * Finishes frame drawing: creates an unnamed group with the next color if the frame is at
   * least `MIN_FRAME_SIZE` and overlaps no other frame; otherwise discards it.
   *
   * @param {PointerEvent} e Window pointer up/cancel.
   * @returns {void}
   */
  const handleFrameUp = useCallback(
    (e: PointerEvent) => {
      const start = frameStartRef.current
      if (start) {
        const cur = toWorld(e.clientX, e.clientY)
        const rect = rectFromPoints(
          start.x,
          start.y,
          clamp(cur.x, WORLD.width),
          clamp(cur.y, WORLD.height),
        )
        const existing = groupsRef.current
        const bigEnough = rect.width >= MIN_FRAME_SIZE && rect.height >= MIN_FRAME_SIZE
        const overlaps = existing.some((g) => rectsOverlap(rect, g))
        if (bigEnough && !overlaps) {
          const newGroup: Group = {
            id: `group-${Date.now()}`,
            name: '',
            color: GROUP_COLORS[existing.length % GROUP_COLORS.length],
            ...rect,
          }
          setGroups((prev) => [...prev, newGroup])
          reassignAll([...existing, newGroup])
        }
      }
      frameStartRef.current = null
      setDraftFrame(null)
      frameAbortRef.current?.abort()
      frameAbortRef.current = null
    },
    [toWorld, reassignAll],
  )

  /**
   * Starts drawing a frame on the empty background (left mouse button or a single finger).
   *
   * @param {ReactPointerEvent} e Pointer down on the canvas background.
   * @returns {void}
   */
  const beginFrameDraw = useCallback(
    (e: ReactPointerEvent) => {
      // Right click → canvas pan; second finger → gesture.
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return
      } else if (pointersRef.current.size >= 1 || gestureRef.current) {
        return
      }
      e.preventDefault()
      closeOpen()
      const start = toWorld(e.clientX, e.clientY)
      frameStartRef.current = start
      setDraftFrame({ x: start.x, y: start.y, width: 0, height: 0 })

      frameAbortRef.current?.abort()
      const controller = new AbortController()
      frameAbortRef.current = controller
      const { signal } = controller
      window.addEventListener('pointermove', handleFrameMove, { signal })
      window.addEventListener('pointerup', handleFrameUp, { signal })
      window.addEventListener('pointercancel', handleFrameUp, { signal })
    },
    [toWorld, closeOpen, handleFrameMove, handleFrameUp],
  )

  /**
   * Renames a group; a non-blank name clears its "unnamed" highlight.
   *
   * @param {string} id Group to rename.
   * @param {string} name New name, untrimmed.
   * @returns {void}
   */
  const renameGroup = useCallback((id: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)))
    if (name.trim() !== '') {
      setUnnamedGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev))
    }
  }, [])

  /**
   * Validates and submits the sorting.
   *
   * Every card must lie in a group and every used group must be named; otherwise a hint is
   * shown and unnamed frames are highlighted. Sent in relative coordinates with the own receipt,
   * so a resubmit updates the same submission.
   *
   * @returns {Promise<void>}
   */
  const handleSubmit = useCallback(async () => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    // Show student ID modal if required and not yet provided
    if (sessionInfo?.requiresStudentId && !studentId.trim() && !showStudentIdModal) {
      setShowStudentIdModal(true)
      return
    }
    const ungrouped = placements.filter((p) => p.groupId === null).length
    if (ungrouped > 0) {
      setSubmitMsg({ text: t.sort.msg.ungrouped(ungrouped), kind: 'error' })
      msgTimerRef.current = window.setTimeout(() => setSubmitMsg(null), 4000)
      return
    }

    const usedGroupIds = new Set(placements.map((p) => p.groupId))
    const unnamed = groups.filter((g) => usedGroupIds.has(g.id) && g.name.trim() === '')
    if (unnamed.length > 0) {
      setUnnamedGroupIds(unnamed.map((g) => g.id))
      setSubmitMsg({ text: t.sort.msg.unnamed(unnamed.length), kind: 'error' })
      msgTimerRef.current = window.setTimeout(() => setSubmitMsg(null), 4000)
      return
    }
    setUnnamedGroupIds([])

    try {
      // Trim names, otherwise " " would count as a name in the analysis.
      const state: SortState = toRelativeState(
        { placements, groups: groups.map((g) => ({ ...g, name: g.name.trim() })), lang },
        WORLD,
      )
      // Add studentId if provided
      if (studentId.trim()) {
        state.studentId = studentId.trim()
      }
      const res = await submitSorting(sessionKey, state, getReceipt(sessionKey))
      if (res.receipt) setReceipt(sessionKey, res.receipt)

      if (res.frozen) {
        setSubmitMsg({ text: t.sort.msg.frozen, kind: 'error' })
      } else if (res.included === false) {
        setSubmitMsg({ text: t.sort.msg.notCounted, kind: 'error' })
      } else {
        setSubmitMsg({ text: t.sort.msg.thanks, kind: 'success' })
      }
      setHandover('offer')
      return
    } catch (err) {
      const unknownSession = err instanceof ApiError && err.status === 404
      setSubmitMsg({
        text: unknownSession ? t.sort.msg.unknownSession : t.sort.msg.failed,
        kind: 'error',
      })
    }

    msgTimerRef.current = window.setTimeout(() => setSubmitMsg(null), 4000)
  }, [placements, groups, sessionKey, lang, t, studentId, showStudentIdModal, sessionInfo])

  /**
   * Resets the board to the start state and drops receipt and draft of this session.
   *
   * @returns {void}
   */
  const clearBoard = useCallback(() => {
    clearReceipt(sessionKey)
    clearDraft(sessionKey)
    setPlacements(initialPlacements())
    setGroups([])
    setPinnedIds([])
    setFrontOrder([])
    setOpenCardId(null)
    setDraftFrame(null)
    setUnnamedGroupIds([])
    const vp = viewportRef.current
    setView(defaultView(vp.width, vp.height))
  }, [sessionKey])

  /**
   * "Done — next person": clears the board for the next student on the same device.
   *
   * @returns {void}
   */
  const resetForNextParticipant = useCallback(() => {
    clearBoard()
    setHandover('none')
    setStudentId('')
    setSubmitMsg({ text: t.sort.msg.readyForNext, kind: 'success' })
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    msgTimerRef.current = window.setTimeout(() => setSubmitMsg(null), 4000)
  }, [clearBoard, t])

  /**
   * Declines the stored draft and starts empty. Also drops the receipt, otherwise the next
   * submit would overwrite the previous person's submission.
   *
   * @returns {void}
   */
  const startFresh = useCallback(() => {
    clearBoard()
    setResumeAsk(false)
  }, [clearBoard])

  /**
   * Keeps sorting after a submit; the receipt is kept, so the next submit updates the same
   * submission.
   *
   * @returns {void}
   */
  const continueSorting = useCallback(() => {
    setHandover('none')
    setSubmitMsg(null)
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
  }, [])

  /**
   * Deletes a frame; its cards become ungrouped (grey).
   *
   * @param {string} id Group to delete.
   * @returns {void}
   */
  const deleteGroup = useCallback(
    (id: string) => {
      const remaining = groupsRef.current.filter((g) => g.id !== id)
      setGroups(remaining)
      reassignAll(remaining)
    },
    [reassignAll],
  )

  // --- Frame move / resize ----------------------------------

  /**
   * Moves or resizes the active frame. A step that would overlap another frame is rejected, so
   * the last valid state stays. On move the contained cards move along; on resize all cards are
   * reassigned.
   *
   * @param {PointerEvent} e Window pointer move.
   * @returns {void}
   */
  const handleGroupMove = useCallback(
    (e: PointerEvent) => {
      const it = groupInteractionRef.current
      if (!it) return
      const w = toWorld(e.clientX, e.clientY)
      const dx = w.x - it.startX
      const dy = w.y - it.startY
      const world = WORLD

      const rect =
        it.mode === 'move'
          ? moveRect(it.orig, dx, dy, world)
          : resizeRect(it.orig, it.mode, dx, dy, world)

      const others = groupsRef.current.filter((g) => g.id !== it.groupId)
      if (others.some((g) => rectsOverlap(rect, g))) return

      const next = groupsRef.current.map((g) =>
        g.id === it.groupId ? { ...g, ...rect } : g,
      )
      setGroups(next)

      if (it.mode === 'move' && it.members) {
        const adx = rect.x - it.orig.x
        const ady = rect.y - it.orig.y
        const start = new Map(it.members.map((m) => [m.cardId, m]))
        setPlacements((prev) =>
          prev.map((p) => {
            if (!p.onCanvas) return p
            const m = start.get(p.cardId)
            const x = m ? clamp(m.x + adx, world.width - CARD_SIZE) : p.x
            const y = m ? clamp(m.y + ady, world.height - CARD_SIZE) : p.y
            return { ...p, x, y, groupId: groupAt(x, y, next) }
          }),
        )
      } else {
        reassignAll(next)
      }
    },
    [toWorld, reassignAll],
  )

  /**
   * Ends the frame move/resize and removes its listeners.
   *
   * @returns {void}
   */
  const handleGroupUp = useCallback(() => {
    groupInteractionRef.current = null
    groupAbortRef.current?.abort()
    groupAbortRef.current = null
  }, [])

  /**
   * Starts moving (`'move'`) or resizing (edge/corner) a frame; on move it remembers the start
   * positions of the contained cards.
   *
   * @param {string} groupId Frame to manipulate.
   * @param {ReactPointerEvent} e Pointer down on the frame or one of its handles.
   * @param {GroupInteractionMode} mode `'move'` or the dragged edge/corner.
   * @returns {void}
   */
  const beginGroupInteraction = useCallback(
    (groupId: string, e: ReactPointerEvent, mode: GroupInteractionMode) => {
      // Pass right click / second finger on to the canvas (no stopPropagation).
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (e.pointerType !== 'mouse' && pointersRef.current.size >= 1) return
      e.preventDefault()
      const g = groupsRef.current.find((x) => x.id === groupId)
      if (!g) return
      closeOpen()
      const w = toWorld(e.clientX, e.clientY)
      const members =
        mode === 'move'
          ? placementsRef.current
              .filter((p) => p.onCanvas && p.groupId === groupId)
              .map((p) => ({ cardId: p.cardId, x: p.x, y: p.y }))
          : undefined
      groupInteractionRef.current = {
        groupId,
        mode,
        startX: w.x,
        startY: w.y,
        orig: { x: g.x, y: g.y, width: g.width, height: g.height },
        members,
      }
      groupAbortRef.current?.abort()
      const controller = new AbortController()
      groupAbortRef.current = controller
      const { signal } = controller
      window.addEventListener('pointermove', handleGroupMove, { signal })
      window.addEventListener('pointerup', handleGroupUp, { signal })
      window.addEventListener('pointercancel', handleGroupUp, { signal })
    },
    [toWorld, closeOpen, handleGroupMove, handleGroupUp],
  )

  return (
    <main className="app">
      {sessionError && (
        <div className="page">
          <p className="error">{sessionError}</p>
          <p className="links">
            <a href="/?beitreten">Zurück zur Sitzungsauswahl</a>
          </p>
        </div>
      )}
      {sessionLoading && (
        <div className="page">
          <p>{t.sort.loading}...</p>
        </div>
      )}
      {showStudentIdModal && sessionInfo?.requiresStudentId && (
        <div className="resume" role="dialog" aria-modal="true" aria-labelledby="student-id-title">
          <div className="resume__box">
            <h2 className="resume__title" id="student-id-title">
              Schüler:innen-ID/Pseudonym
            </h2>
            <p className="resume__text">
              Bitte gib deine Schüler:innen-ID oder ein Pseudonym ein, um dein Ergebnis abzuschicken.
            </p>
            <div className="resume__actions">
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="Deine ID"
                autoFocus
                className="student-id-input"
              />
              <button
                type="button"
                className="btn-submit"
                onClick={() => {
                  if (studentId.trim()) {
                    setShowStudentIdModal(false)
                    handleSubmit()
                  }
                }}
                disabled={!studentId.trim()}
              >
                Weiter
              </button>
            </div>
          </div>
        </div>
      )}
      {resumeAsk && restored && (
        <div className="resume" role="dialog" aria-modal="true" aria-labelledby="resume-title">
          <div className="resume__box">
            <h2 className="resume__title" id="resume-title">
              {t.resume.title}
            </h2>
            <p className="resume__text">
              {t.resume.text(t.resume.age(ageInMinutes(restored.savedAt)))}
            </p>
            <div className="resume__actions">
              <button type="button" className="btn-submit" onClick={() => setResumeAsk(false)}>
                {t.resume.yes}
              </button>
              <button type="button" className="btn-handover" onClick={startFresh}>
                {t.resume.no}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Fixed to the screen; lets clicks through to the canvas. */}
      <div className="app__overlay">
        <div className="app__bar">
          <button
            type="button"
            className="hamburger"
            aria-label={t.menu.open}
            aria-expanded={menuOpen}
            onClick={() =>
              setMenuOpen((o) => {
                if (!o) closeHelp()
                return !o
              })
            }
          >
            ☰
          </button>
          <h1 className="app__title">ML-Sortiertool</h1>
        </div>
        {menuOpen && (
          <nav className="menu">
            <a className="menu__item" href="?anlegen">
              {t.menu.create}
            </a>
            <a className="menu__item" href="?beitreten">
              {t.menu.join}
            </a>
            <a className="menu__item" href="?verwalten">
              {t.menu.manage}
            </a>
            <hr className="menu__sep" />
            <a className="menu__item" href="?impressum">
              {t.menu.legal}
            </a>
            <a className="menu__item" href={SOURCE_URL} target="_blank" rel="noreferrer">
              {t.menu.source}
            </a>
            <hr className="menu__sep" />
            <div className="menu__langs" role="group" aria-label={t.menu.language}>
              {LANGS.map((entry) => (
                <button
                  key={entry.lang}
                  type="button"
                  className={`menu__lang${entry.lang === lang ? ' is-active' : ''}`}
                  aria-pressed={entry.lang === lang}
                  onClick={() => {
                    setLang(entry.lang)
                    setMenuOpen(false)
                  }}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          </nav>
        )}
        <div className="app__task">
          <p className="app__task-text">{t.sort.task}</p>
          
          <span
            className="help"
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') {
                setMenuOpen(false)
                setHelpHover(true)
              }
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setHelpHover(false)
            }}
          >
            <button
              type="button"
              className={helpOpen ? 'help-btn is-open' : 'help-btn'}
              aria-expanded={helpOpen}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse') return
                helpToggledRef.current = true
                setMenuOpen(false)
                toggleHelpPin()
              }}
              onClick={() => {
                if (helpToggledRef.current) {
                  helpToggledRef.current = false
                  return
                }
                setMenuOpen(false)
                toggleHelpPin()
              }}
            >
              <span className="help-btn__icon" aria-hidden="true">
                ?
              </span>
              {t.sort.helpButton}
            </button>
            {/* Anchored absolutely, so opening does not stretch the pill. */}
            {helpOpen && (
              <div className="help-popover" role="tooltip">
                {t.sort.help.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </span>
        </div>
        {sessionKey && sessionKey !== DEFAULT_SESSION_KEY && (
          <p className="app__hint">{t.sort.session(sessionKey)}</p>
        )}
      </div>
      <Canvas
        canvasRef={canvasRef}
        cards={cards}
        placements={placements}
        groups={groups}
        view={view}
        draftFrame={draftFrame}
        draggingId={draggingId}
        openCardId={openCardId}
        pinnedIds={pinnedIds}
        frontOrder={frontOrder}
        unnamedGroupIds={unnamedGroupIds}
        onCanvasPointerDown={handleCanvasPointerDown}
        onBeginDrag={beginDrag}
        onBackgroundPointerDown={beginFrameDraw}
        onBeginGroupInteraction={beginGroupInteraction}
        onRenameGroup={renameGroup}
        onDeleteGroup={deleteGroup}
        onTogglePin={togglePin}
      />
      <div className="canvas-zoom">
        <button
          type="button"
          aria-label={t.sort.zoomIn}
          onClick={() => zoomToCenter(ZOOM_STEP)}
          disabled={view.scale >= MAX_SCALE}
        >
          +
        </button>
        <button
          type="button"
          className="canvas-zoom__reset"
          aria-label={t.sort.zoomReset}
          title={t.sort.zoomResetTitle}
          onClick={resetView}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          type="button"
          aria-label={t.sort.zoomOut}
          onClick={() => zoomToCenter(1 / ZOOM_STEP)}
          disabled={view.scale <= minScale + 0.001}
        >
          −
        </button>
      </div>
      <div className="app__actions">
        {submitMsg && (
          <div className={`submit-msg submit-msg--${submitMsg.kind}`}>
            {submitMsg.text}
          </div>
        )}
        {handover === 'none' ? (
          <button type="button" className="btn-submit" onClick={handleSubmit}>
            {t.sort.submit}
          </button>
        ) : handover === 'offer' ? (
          <div className="handover">
            <button type="button" className="btn-submit" onClick={continueSorting}>
              {t.sort.continue}
            </button>
            <button
              type="button"
              className="btn-handover"
              onClick={() => setHandover('confirm')}
            >
              {t.sort.handover}
            </button>
          </div>
        ) : (
          <div className="handover">
            <span className="handover__ask">{t.sort.resetAsk}</span>
            <button
              type="button"
              className="btn-handover btn-handover--danger"
              onClick={resetForNextParticipant}
            >
              {t.sort.resetConfirm}
            </button>
            <button
              type="button"
              className="btn-handover"
              onClick={() => setHandover('offer')}
            >
              {t.sort.cancel}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
