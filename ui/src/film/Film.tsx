import { MotionConfig, motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Store, defaultIsland, defaultMascot, island, mascot, useStore, type IslandState, type MascotState, type Step } from '../bridge'
import { Mascot } from '../components/Mascot'
import { cn } from '../components/bits'
import { Island } from '../views/Island'
import { AppWindow, MenuBar, SystemCursor } from '../views/Showcase'

/**
 * The README's demo film: three asks on a pretend Mac, with a camera that
 * dives into the notch and follows Plip around. Everything on screen is a
 * function of the film clock, so scripts/film.mjs can render it frame by frame.
 * Open /film.html on the dev server to watch it loop (?at=8550 starts there).
 */

const W = 1440
const H = 900
const FPS = 25

// The moments everything else hangs off (ms).
const AT = {
  // 1. shows you how
  hold1: 250, think1: 1700, file: 2250, clickFile: 3650, export: 3700, sub: 4550, clickPdf: 5300, done1: 5350, rest1: 6000, minimize: 6150,
  // 2. does the busywork
  tidy: 6800, hold2: 6950, think2: 8000, confirm: 8550, clickTidy: 9850, done2: 9900, flights: 10100, rest2: 11300,
  // 3. finds your stuff
  find: 11800, hold3: 11950, think3: 13000, results: 13500, rest3: 14200, open: 14350,
  end: 16200, reset: 18700,
}
const LENGTH = AT.reset + 300

const NOTCH = { width: 196, height: 34, hasNotch: true }

// The README's use-case pictures: a frame each, cropped to [x, y, width, height].
const STILLS = [
  { name: 'use-show-how', at: AT.clickPdf - 60, crop: [100, 0, 1320, 660] },
  { name: 'use-busywork', at: AT.clickTidy - 210, crop: [60, 0, 1320, 660] },
  { name: 'use-find', at: AT.rest3 - 80, crop: [60, 0, 1320, 660] },
]

declare global {
  interface Window {
    __film?: { length: number; fps: number; ready: boolean; stills: typeof STILLS }
  }
}

type Point = { x: number; y: number }

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const span = (t: number, start: number, length: number) => (length <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / length))
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount
const ease = (v: number) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2)
const easeOut = (v: number) => 1 - (1 - v) ** 3
const overshoot = (v: number) => 1 + 2.2 * (v - 1) ** 3 + 1.2 * (v - 1) ** 2
// Someone talking: a level that wanders between 0.3 and 0.9.
const voice = (t: number) => clamp(0.55 + 0.2 * Math.sin(t / 83) + 0.14 * Math.sin(t / 37 + 1.3) + 0.09 * Math.sin(t / 19 + 0.4))

// -- the script --------------------------------------------------------------

type Spot = 'file' | 'export' | 'pdf'

interface Cue {
  at: number
  island?: Partial<IslandState>
  mascot?: Partial<MascotState>
  spot?: Spot                                              // where the flying Plip points; the notch otherwise
  typing?: { text: string; from: number; every: number }   // the transcript, a word at a time
}

const step = (id: string, label: string, status: Step['status'], detail?: string): Step => ({ id, label, status, detail })
const CLAUDE = { label: 'Claude', kind: 'subscription' as const }
const ASK = { how: 'how do I export this as a PDF?', tidy: 'tidy up my desktop', find: 'find my lease pdf' }
const PLAN = ['Open the File menu', 'Export To', 'Choose PDF']

// Every step reuses the 'walk' chip id: a new id would wrap under the leaving chip for a moment.
const walk = (planIndex: number, answer: string, steps: Step[], extra: Partial<IslandState> = {}): Partial<IslandState> =>
  ({ phase: 'answering', engine: CLAUDE, latencyMs: 1180, plan: PLAN, planIndex, answer, steps, ...extra })
const point = (label: string, look: Point, lean: number): Partial<MascotState> => ({ mood: 'pointing', label, look, lean })

const CUES: Cue[] = [
  { at: 0 },
  // 1. Shows you how
  { at: AT.hold1, island: { phase: 'listening' }, mascot: { mood: 'listening' }, typing: { text: ASK.how, from: 550, every: 130 } },
  {
    at: AT.think1,
    island: { phase: 'thinking', transcript: ASK.how, steps: [step('look', 'Looked at your screen', 'done', '84ms'), step('think', 'Claude is thinking', 'active')] },
    mascot: { mood: 'thinking' },
  },
  { at: AT.file, island: walk(0, 'Click File up top, right next to Keynote.', [step('walk', 'Found “File” on screen', 'done', 'AX')]), mascot: point('File', { x: -0.1, y: -1 }, -4), spot: 'file' },
  { at: AT.export, island: walk(1, 'Nice. Now hover over Export To.', [step('walk', 'You opened File', 'done', 'diff')]), mascot: point('Export To', { x: -1, y: -0.35 }, -6), spot: 'export' },
  { at: AT.sub, island: walk(2, 'Last one: pick PDF.', [step('walk', 'Export To is open', 'done', 'diff')]), mascot: point('PDF…', { x: -1, y: -0.35 }, -6), spot: 'pdf' },
  { at: AT.done1, island: walk(3, 'That’s it. Hit Save and your PDF is ready.', [step('walk', 'Walked you through 3 steps', 'done')], { done: true, finished: 'done' }), mascot: { mood: 'happy' } },
  { at: AT.rest1 },
  // 2. Does the busywork
  { at: AT.hold2, island: { phase: 'listening' }, mascot: { mood: 'listening' }, typing: { text: ASK.tidy, from: 7250, every: 160 } },
  {
    at: AT.think2,
    island: { phase: 'thinking', transcript: ASK.tidy, steps: [step('look', 'Looked at your Desktop', 'done', '17 files'), step('think', 'Claude is planning', 'active')] },
    mascot: { mood: 'thinking' },
  },
  {
    at: AT.confirm,
    island: {
      phase: 'answering', engine: CLAUDE, latencyMs: 1320, done: true,
      answer: 'I’ll sort your desktop into folders. Here’s the plan.',
      confirm: { title: 'Tidy 17 files', lines: ['Screenshots → 9', 'Documents → 5', 'Images → 3'], confirm: 'Tidy up', name: 'organize_desktop' },
    },
    mascot: { mood: 'thinking' },
  },
  {
    at: AT.done2,
    island: { phase: 'answering', engine: CLAUDE, latencyMs: 1320, done: true, finished: 'done', answer: 'Done. 17 files tidied. Say “undo” to put them back.', steps: [step('move', 'Moved 17 files', 'done', '0.4s')] },
    mascot: { mood: 'happy' },
  },
  { at: AT.rest2 },
  // 3. Finds your stuff
  { at: AT.hold3, island: { phase: 'listening' }, mascot: { mood: 'listening' }, typing: { text: ASK.find, from: 12250, every: 160 } },
  { at: AT.think3, island: { phase: 'thinking', transcript: ASK.find, steps: [step('search', 'Searching files for “lease”', 'active')] }, mascot: { mood: 'thinking' } },
  {
    at: AT.results,
    island: {
      phase: 'answering', engine: CLAUDE, latencyMs: 940, done: true,
      answer: 'Found it, in Documents → Apartment. Opening it now.',
      results: [
        { title: 'Lease-2026.pdf', detail: '~/Documents/Apartment', path: '/Users/you/Documents/Apartment/Lease-2026.pdf' },
        { title: 'Lease renewal draft.pdf', detail: '~/Downloads', path: '/Users/you/Downloads/Lease renewal draft.pdf' },
      ],
      steps: [step('search', 'Searched files for “lease”', 'done', '2 found')],
    },
    mascot: { mood: 'speaking' },
  },
  { at: AT.rest3 },
]

// Hold ⌃⌥ for these stretches.
const HOLDS: [number, number][] = [[AT.hold1, AT.think1], [AT.hold2, AT.think2], [AT.hold3, AT.think3]]

const CAPTIONS = [
  { n: 1, text: 'Shows you how', from: 0, to: AT.tidy },
  { n: 2, text: 'Does the busywork', from: AT.tidy, to: AT.find },
  { n: 3, text: 'Finds your stuff', from: AT.find, to: AT.end },
]

// Camera moves: look at (x, y) on the desktop, s times closer.
type Shot = Point & { s: number }
const WIDE: Shot = { x: W / 2, y: H / 2, s: 1 }
const CAMERA: (Shot & { at: number; length: number })[] = [
  { at: AT.hold1 - 50, length: 700, x: 720, y: 0, s: 2.1 },
  { at: AT.file + 50, length: 700, x: 540, y: 250, s: 1.45 },
  { at: AT.done1 + 100, length: 650, ...WIDE },
  { at: AT.hold2, length: 650, x: 720, y: 0, s: 1.75 },
  { at: AT.done2 + 50, length: 650, ...WIDE },
  { at: AT.hold3, length: 650, x: 720, y: 0, s: 2 },
  { at: AT.open, length: 750, x: 720, y: 470, s: 1.12 },
  { at: AT.reset, length: 0, ...WIDE },
]

type Target = Point | 'file' | 'export' | 'pdf' | 'tidy'
const CURSOR_HOME = { x: 930, y: 560 }
const CURSOR: { at: number; length: number; to: Target }[] = [
  { at: AT.clickFile - 700, length: 650, to: 'file' },
  { at: AT.sub - 550, length: 480, to: 'export' },
  { at: AT.clickPdf - 450, length: 400, to: 'pdf' },
  { at: AT.clickTidy - 700, length: 650, to: 'tidy' },
  { at: AT.hold3 + 50, length: 800, to: { x: 1070, y: 660 } },
  { at: AT.reset, length: 0, to: CURSOR_HOME },
]
const CLICKS = [AT.clickFile, AT.clickPdf, AT.clickTidy]

// Keynote's File menu and its Export To submenu, laid out on a fixed grid so Plip and the cursor know where rows are.
const ROW = 26
const GAP = 9
const MENU = { top: 36, width: 232, pad: 6 }
const FILE_ROWS = ['New', 'Open…', 'Open Recent', null, 'Close', 'Save', 'Duplicate', 'Rename…', null, 'Export To', 'Share…', null, 'Print…']
const EXPORT_ROWS = ['PDF…', 'Word…', 'PowerPoint…', 'Movie…', 'Animated GIF…', 'Images…', 'HTML…']
const EXPORT_Y = MENU.top + MENU.pad + 7 * ROW + 2 * GAP + ROW / 2
const SUB = { top: EXPORT_Y - ROW / 2 - MENU.pad, width: 184 }

// The messy desktop: 9 screenshots, 5 documents, 3 images.
type Kind = 'shot' | 'pdf' | 'doc' | 'photo'
const FILES: { name: string; kind: Kind; x: number; y: number }[] = [
  { name: 'Screenshot 2026-10-02 at 9.14.22 AM', kind: 'shot', x: 1345, y: 500 },
  { name: 'Invoice-0423.pdf', kind: 'pdf', x: 95, y: 470 },
  { name: 'Screenshot 2026-10-01 at 4.02.10 PM', kind: 'shot', x: 90, y: 300 },
  { name: 'IMG_2041.HEIC', kind: 'photo', x: 85, y: 650 },
  { name: 'Screenshot 2026-09-30 at 11.47.03 AM', kind: 'shot', x: 560, y: 520 },
  { name: 'Resume v7 FINAL.pdf', kind: 'pdf', x: 780, y: 380 },
  { name: 'Screenshot 2026-09-29 at 6.20.44 PM', kind: 'shot', x: 1150, y: 470 },
  { name: 'logo-final-final.png', kind: 'photo', x: 540, y: 822 },
  { name: 'Screenshot 2026-09-29 at 6.21.02 PM', kind: 'shot', x: 420, y: 690 },
  { name: 'Boarding pass.pdf', kind: 'pdf', x: 265, y: 822 },
  { name: 'Screenshot 2026-09-28 at 10.05.31 AM', kind: 'shot', x: 1355, y: 690 },
  { name: 'notes.txt', kind: 'doc', x: 1190, y: 280 },
  { name: 'Screenshot 2026-09-27 at 8.33.17 PM', kind: 'shot', x: 800, y: 822 },
  { name: 'IMG_2047.jpg', kind: 'photo', x: 1340, y: 822 },
  { name: 'Screenshot 2026-09-26 at 2.12.50 PM', kind: 'shot', x: 330, y: 380 },
  { name: 'Budget 2026.numbers', kind: 'doc', x: 1075, y: 822 },
  { name: 'Screenshot 2026-09-25 at 7.48.09 AM', kind: 'shot', x: 940, y: 600 },
]
const FOLDERS = [
  { name: 'Screenshots', x: 1350, y: 100 },
  { name: 'Documents', x: 1350, y: 225 },
  { name: 'Images', x: 1350, y: 350 },
]
const folderOf = (kind: Kind) => (kind === 'shot' ? 0 : kind === 'photo' ? 2 : 1)
const FLIGHT = { start: AT.flights, stagger: 40, length: 650 }

// -- the clock ---------------------------------------------------------------

const film = new Store({ t: 0 })
let applied = -1

function cueAt(t: number) {
  let index = 0
  CUES.forEach((cue, position) => {
    if (cue.at <= t) index = position
  })
  return index
}

/** Puts the island and Plip where the script says they are at t. */
function drive(t: number) {
  if (t < film.get().t) applied = -1
  const index = cueAt(t)
  const cue = CUES[index]
  if (index !== applied) {
    applied = index
    island.set({ ...defaultIsland, notch: NOTCH, ...cue.island })
    mascot.set({ ...defaultMascot, ...cue.mascot })
  }
  if (cue.typing) {
    const { text, from, every } = cue.typing
    const words = text.split(' ')
    const count = clamp(Math.floor((t - from) / every) + 1, 0, words.length)
    const talking = count > 0 && t < from + words.length * every + 120
    const level = talking ? voice(t) : 0.12 + 0.05 * Math.sin(t / 60)
    island.set({ transcript: words.slice(0, count).join(' '), level })
    mascot.set({ level })
  } else if (cue.island?.phase === 'answering' && !cue.island.done) {
    island.set({ level: voice(t) * 0.8 })
  }
  film.set({ t })
}

function cameraAt(t: number): Shot {
  let shot = WIDE
  for (const move of CAMERA) {
    if (t < move.at) break
    const amount = ease(span(t, move.at, move.length))
    if (amount < 1) return { x: mix(shot.x, move.x, amount), y: mix(shot.y, move.y, amount), s: shot.s * (move.s / shot.s) ** amount }
    shot = move
  }
  return shot
}

/** The part of the desktop in frame, kept inside its edges. */
function frameOf(shot: Shot) {
  const width = W / shot.s
  const height = H / shot.s
  return { left: clamp(shot.x - width / 2, 0, W - width), top: clamp(shot.y - height / 2, 0, H - height), s: shot.s }
}

function cursorAt(t: number, where: (target: Target) => Point): Point {
  let at: Point = CURSOR_HOME
  for (const move of CURSOR) {
    if (t < move.at) break
    const to = where(move.to)
    const amount = ease(span(t, move.at, move.length))
    if (amount < 1) return { x: mix(at.x, to.x, amount), y: mix(at.y, to.y, amount) - 26 * Math.sin(Math.PI * amount) }
    at = to
  }
  return at
}

/** Where an element sits on the desktop, ignoring the camera. */
function deskPoint(element: HTMLElement | null, desk: HTMLElement): Point | undefined {
  if (!element) return undefined
  let x = element.offsetWidth / 2
  let y = element.offsetHeight / 2
  for (let node: HTMLElement | null = element; node && node !== desk; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft
    y += node.offsetTop
  }
  return { x, y }
}

const marks: { file?: Point; tidy?: Point } = {}

// -- the film ----------------------------------------------------------------

export function Film() {
  const { t } = useStore(film)
  const deskRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState(1)
  // Layout animations (the island's chips) measure where things are on screen; give them desktop coordinates
  // instead, or every camera move looks like the chips jumped.
  const toDesk = useCallback((point: Point) => {
    const box = deskRef.current?.getBoundingClientRect()
    if (!box) return point
    const scale = box.width / W
    return { x: (point.x - box.left) / scale, y: (point.y - box.top) / scale }
  }, [])

  useEffect(() => {
    const resize = () => setFit(Math.min(window.innerWidth / W, window.innerHeight / H))
    resize()
    window.addEventListener('resize', resize)
    window.__film = { length: LENGTH, fps: FPS, ready: false, stills: STILLS }
    void Promise.all([document.fonts.load('500 16px Geist'), document.fonts.load('700 16px Geist'), document.fonts.load('400 12px "Geist Mono"')])
      .then(() => document.fonts.ready)
      .then(() => { window.__film!.ready = true })
    const start = performance.now() - Number(new URLSearchParams(location.search).get('at') ?? 0)
    let frame = 0
    const tick = () => {
      drive((performance.now() - start) % LENGTH)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // Measured once they exist; the Tidy up button moves with the island, so it's measured after it settles.
  const desk = deskRef.current
  if (desk && !marks.file) marks.file = deskPoint(fileRef.current, desk)
  if (t < AT.confirm + 500) delete marks.tidy
  else if (desk && !marks.tidy) marks.tidy = deskPoint([...desk.querySelectorAll('button')].find((button) => button.textContent?.includes('Tidy up')) ?? null, desk)

  const file = marks.file ?? { x: 140, y: 17 }
  const menuLeft = file.x - 20
  const subLeft = menuLeft + MENU.width - 4
  const spots: Record<Spot, Point> = {
    file: { x: file.x + 4, y: 54 },
    export: { x: menuLeft + 196, y: EXPORT_Y + 8 },
    pdf: { x: subLeft + 128, y: EXPORT_Y + 8 },
  }
  const where = (target: Target): Point =>
    target === 'file' ? { x: file.x - 2, y: file.y - 2 }
      : target === 'export' ? { x: menuLeft + 92, y: EXPORT_Y - 3 }
        : target === 'pdf' ? { x: subLeft + 44, y: EXPORT_Y - 3 }
          : target === 'tidy' ? { x: (marks.tidy?.x ?? 930) - 4, y: (marks.tidy?.y ?? 260) - 4 }
            : target

  const cue = CUES[cueAt(t)]
  const camera = frameOf(cameraAt(t))
  const cursor = cursorAt(t, where)
  const outro = t < AT.reset ? ease(span(t, AT.end, 400)) : 1 - ease(span(t, AT.reset, 300))
  const app = t < AT.minimize + 300 || t >= AT.reset ? 'Keynote' : t < AT.open ? 'Finder' : 'Preview'
  const fileOpen = t >= AT.clickFile && t < AT.done1

  return (
    <div className="grid h-full w-full place-items-center overflow-hidden bg-black">
      <div className="relative shrink-0 overflow-hidden bg-black" style={{ width: W * fit, height: H * fit }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${fit})` }}>
          {/* the desktop, seen through the camera */}
          <div
            className="absolute inset-0 origin-center"
            style={{ transform: `scale(${1 + 0.04 * outro})`, filter: outro > 0.01 ? `blur(${16 * outro}px)` : undefined }}
          >
            <div
              ref={deskRef}
              className="absolute left-0 top-0 origin-top-left overflow-hidden"
              style={{ width: W, height: H, transform: `translate(${-camera.left * camera.s}px, ${-camera.top * camera.s}px) scale(${camera.s})` }}
            >
              <MotionConfig transformPagePoint={toDesk}>
                <Wallpaper />
                <Desktop t={t} />
                <Minimizing t={t}>
                  <AppWindow />
                </Minimizing>
                <LeaseWindow t={t} />
                <MenuBar
                  fileRef={fileRef}
                  highlight={fileOpen}
                  app={app}
                  items={app === 'Finder' ? ['Edit', 'View', 'Go', 'Window', 'Help'] : app === 'Preview' ? ['Edit', 'View', 'Go', 'Tools', 'Window', 'Help'] : undefined}
                />
                <FileMenu t={t} left={menuLeft} subLeft={subLeft} />

                {/* the physical notch, then Plip's island fused onto it */}
                <div className="absolute left-1/2 top-0 z-40 -translate-x-1/2 rounded-b-[12px] bg-black" style={{ width: NOTCH.width, height: NOTCH.height }} />
                <div className="absolute inset-x-0 top-0 z-50">
                  <Island />
                </div>

                <Cursor t={t} at={cursor} />
                <FlyingPlip at={cue.spot ? spots[cue.spot] : null} />
              </MotionConfig>
            </div>
          </div>

          <Captions t={t} />
          <KeysHud t={t} />
          <EndCard t={t} />
        </div>
      </div>
    </div>
  )
}

// -- pieces ------------------------------------------------------------------

/** A quieter take on the showcase wallpaper: fewer, dimmer glows keep the GIF small. */
function Wallpaper() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#08111d]">
      <div className="absolute -left-56 -top-64 size-[1000px] rounded-full bg-[#0e7490] opacity-40 blur-[160px]" />
      <div className="absolute -bottom-80 -right-40 size-[900px] rounded-full bg-[#1d4ed8] opacity-35 blur-[170px]" />
    </div>
  )
}

function FlyingPlip({ at }: { at: Point | null }) {
  const state = useStore(mascot)
  const docked = !at
  const spot = at ?? { x: W / 2, y: NOTCH.height - 4 }
  return (
    <motion.div
      className="absolute z-[60]"
      initial={false}
      animate={{ left: spot.x - 13, top: spot.y - 13, opacity: docked ? 0 : 1, scale: docked ? 0.3 : 1 }}
      transition={{ type: 'spring', stiffness: 110, damping: 16, mass: 0.9, opacity: { duration: 0.25 } }}
    >
      <Mascot mood={state.mood} level={state.level} look={state.look} lean={state.lean} size={26} />
      {state.mood === 'pointing' && state.label && !docked && (
        <motion.div
          key={state.label}
          initial={{ opacity: 0, scale: 0.6, x: -4 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ delay: 0.45, type: 'spring', stiffness: 500, damping: 26 }}
          className="brand-gradient absolute left-[29px] top-[16px] origin-left whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold text-slate-950 shadow-[0_6px_18px_-6px_rgba(95,142,244,0.9),inset_0_1px_0_rgba(255,255,255,0.5)]"
        >
          {state.label}
        </motion.div>
      )}
    </motion.div>
  )
}

function Cursor({ t, at }: { t: number; at: Point }) {
  const click = CLICKS.find((time) => t >= time && t < time + 500)
  const since = click === undefined ? Infinity : t - click
  return (
    <>
      {click !== undefined && (
        <span
          className="absolute z-[56] rounded-full border-2 border-white/80"
          style={{
            left: at.x + 2,
            top: at.y + 2,
            width: 60,
            height: 60,
            margin: -30,
            opacity: 0.7 * (1 - since / 500),
            transform: `scale(${mix(0.15, 1, easeOut(since / 500))})`,
          }}
        />
      )}
      <div className="absolute inset-0 z-[57]" style={{ transform: `scale(${since < 140 ? 0.86 : 1})`, transformOrigin: `${at.x + 2}px ${at.y + 2}px` }}>
        <SystemCursor x={at.x} y={at.y} />
      </div>
    </>
  )
}

function FileMenu({ t, left, subLeft }: { t: number; left: number; subLeft: number }) {
  const shown = span(t, AT.clickFile, 110) * (1 - span(t, AT.done1, 140))
  const sub = span(t, AT.sub, 110) * (1 - span(t, AT.done1, 140))
  if (shown <= 0) return null
  const exportLit = t >= AT.sub - 70        // the cursor is on it
  const pdfLit = t >= AT.clickPdf - 70
  return (
    <>
      <div className="absolute z-[35] rounded-[10px] bg-[#2b2b33]/90 text-[13.5px] text-white/90 shadow-2xl ring-1 ring-white/10 backdrop-blur-2xl"
        style={{ left, top: MENU.top, width: MENU.width, padding: MENU.pad, opacity: shown }}>
        {FILE_ROWS.map((row, index) =>
          row === null ? (
            <div key={index} className="flex items-center px-2" style={{ height: GAP }}><div className="h-px w-full bg-white/10" /></div>
          ) : (
            <div key={row} className={cn('flex items-center justify-between rounded-[6px] px-2.5', row === 'Export To' && exportLit && 'bg-[#3d6bff]')} style={{ height: ROW }}>
              {row}
              {row === 'Export To' && <ChevronRight className="size-3.5" />}
            </div>
          ),
        )}
      </div>
      {sub > 0 && (
        <div className="absolute z-[36] rounded-[10px] bg-[#2b2b33]/90 text-[13.5px] text-white/90 shadow-2xl ring-1 ring-white/10 backdrop-blur-2xl"
          style={{ left: subLeft, top: SUB.top, width: SUB.width, padding: MENU.pad, opacity: sub }}>
          {EXPORT_ROWS.map((row) => (
            <div key={row} className={cn('flex items-center rounded-[6px] px-2.5', row === 'PDF…' && pdfLit && 'bg-[#3d6bff]')} style={{ height: ROW }}>{row}</div>
          ))}
        </div>
      )}
    </>
  )
}

/** Keynote goes down to the Dock after the first ask, and comes back for the next loop. */
function Minimizing({ t, children }: { t: number; children: React.ReactNode }) {
  const amount = t < AT.reset ? span(t, AT.minimize, 500) ** 2 : 0
  if (amount >= 1) return null
  return (
    <div className="absolute inset-0 z-10" style={{ transformOrigin: '720px 960px', transform: `scale(${mix(1, 0.04, amount)})`, opacity: 1 - span(amount, 0.55, 0.45) }}>
      {children}
    </div>
  )
}

function Desktop({ t }: { t: number }) {
  const tidied = t < AT.reset
  return (
    <div className="absolute inset-0 z-[5]">
      {FOLDERS.map((folder, index) => {
        const shown = tidied ? overshoot(span(t, FLIGHT.start - 120 + index * 90, 480)) : 0
        if (shown <= 0) return null
        const bump = FILES.reduce((sum, item, order) => {
          if (folderOf(item.kind) !== index) return sum
          const landed = t - (FLIGHT.start + order * FLIGHT.stagger + FLIGHT.length * 0.9)
          return sum + (landed > 0 && landed < 260 ? Math.sin((Math.PI * landed) / 260) * 0.1 : 0)
        }, 0)
        return (
          <DeskItem key={folder.name} x={folder.x} y={folder.y} name={folder.name} style={{ transform: `scale(${shown * (1 + Math.min(bump, 0.16))})`, opacity: clamp(shown) }}>
            <Folder />
          </DeskItem>
        )
      })}
      {FILES.map((item, order) => {
        const amount = tidied ? span(t, FLIGHT.start + order * FLIGHT.stagger, FLIGHT.length) : 0
        if (amount >= 1) return null
        const to = FOLDERS[folderOf(item.kind)]
        const move = ease(amount)
        const x = mix(item.x, to.x, move)
        const y = mix(item.y, to.y, move) - 110 * Math.sin(Math.PI * move)
        return (
          <DeskItem
            key={item.name}
            x={x}
            y={y}
            name={item.name}
            style={{ transform: `scale(${mix(1, 0.32, move)}) rotate(${mix(0, order % 2 ? 9 : -9, Math.sin(Math.PI * move))}deg)`, opacity: 1 - span(amount, 0.82, 0.18) }}
            label={amount === 0}
          >
            <FileIcon kind={item.kind} seed={order} />
          </DeskItem>
        )
      })}
    </div>
  )
}

function DeskItem({ x, y, name, style, label = true, children }: { x: number; y: number; name: string; style?: React.CSSProperties; label?: boolean; children: React.ReactNode }) {
  return (
    <div className="absolute flex w-[124px] flex-col items-center" style={{ left: x - 62, top: y - 36, ...style }}>
      <div className="flex h-[70px] items-end justify-center [filter:drop-shadow(0_4px_8px_rgba(0,0,0,0.45))]">{children}</div>
      {label && (
        <div className="mt-1 line-clamp-2 w-full text-center text-[11.5px] font-medium leading-[1.25] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">{name}</div>
      )}
    </div>
  )
}

function FileIcon({ kind, seed }: { kind: Kind; seed: number }) {
  const hue = (seed * 47) % 360
  if (kind === 'shot') {
    return (
      <div className="h-[50px] w-[76px] overflow-hidden rounded-[3px] bg-[#1d1d22] ring-[2.5px] ring-white">
        <div className="h-[8px] bg-[#30303a]" />
        <div className="flex gap-1 p-1">
          <div className="h-[32px] w-[16px] rounded-[2px] bg-white/15" />
          <div className="h-[32px] flex-1 rounded-[2px]" style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 64%), hsl(${hue + 40} 65% 42%))` }} />
        </div>
      </div>
    )
  }
  if (kind === 'photo') {
    return (
      <div className="relative h-[58px] w-[66px] overflow-hidden rounded-[3px] ring-[2.5px] ring-white" style={{ background: `linear-gradient(180deg, hsl(${hue} 80% 72%), hsl(${hue + 30} 85% 58%))` }}>
        <div className="absolute right-2 top-2 size-3 rounded-full bg-[#fff7d6]" />
        <div className="absolute inset-x-0 bottom-0 h-[30px] bg-[#263a5a]" style={{ clipPath: 'polygon(0 100%, 0 45%, 28% 0, 52% 55%, 70% 25%, 100% 70%, 100% 100%)' }} />
      </div>
    )
  }
  return (
    <div className="relative h-[68px] w-[54px] bg-white" style={{ clipPath: 'polygon(0 0, 70% 0, 100% 22%, 100% 100%, 0 100%)', borderRadius: 3 }}>
      <div className="absolute right-0 top-0 h-[15px] w-[16px] rounded-bl-[3px] bg-[#cfd5de]" />
      <div className="space-y-[5px] px-[8px] pt-[20px]">
        {[1, 0.8, 0.95, 0.6].map((width, index) => (
          <div key={index} className={cn('h-[3px] rounded-full', kind === 'pdf' ? 'bg-slate-300' : 'bg-sky-300')} style={{ width: `${width * 100}%` }} />
        ))}
      </div>
      {kind === 'pdf' && <div className="absolute inset-x-0 bottom-[8px] bg-[#e5484d] text-center text-[9px] font-bold leading-[13px] text-white">PDF</div>}
    </div>
  )
}

function Folder() {
  return (
    <svg width="80" height="64" viewBox="0 0 80 64" aria-hidden>
      <defs>
        <linearGradient id="film-folder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#93cdff" />
          <stop offset="1" stopColor="#4a9cf0" />
        </linearGradient>
      </defs>
      <path d="M4 10a5 5 0 0 1 5-5h20a5 5 0 0 1 3.6 1.5L37 11h34a5 5 0 0 1 5 5v6H4z" fill="#3f86dc" />
      <rect x="4" y="16" width="72" height="45" rx="5" fill="url(#film-folder)" />
      <rect x="4" y="16" width="72" height="1.5" fill="#ffffff" opacity="0.55" />
    </svg>
  )
}

/** Preview opens the lease out of the island. */
function LeaseWindow({ t }: { t: number }) {
  const amount = t < AT.reset ? span(t, AT.open, 650) : 0
  if (amount <= 0) return null
  const box = { left: 330, top: 128, width: 780, height: 690 }
  return (
    <div
      className="absolute z-[12] overflow-hidden rounded-[12px] bg-[#1e1e22] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10"
      style={{ ...box, transformOrigin: `${720 - box.left}px ${150 - box.top}px`, transform: `scale(${mix(0.06, 1, overshoot(amount))})`, opacity: easeOut(span(amount, 0, 0.35)) }}
    >
      <div className="flex h-[48px] items-center gap-2 border-b border-white/[0.06] bg-[#2a2a30] px-4">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <div className="ml-4 leading-tight">
          <div className="text-[13px] font-semibold text-white/85">Lease-2026.pdf</div>
          <div className="text-[11px] text-white/40">Page 1 of 12</div>
        </div>
      </div>
      <div className="flex h-[642px] justify-center bg-[#3b3b42] pt-7">
        <div className="h-[760px] w-[560px] bg-white px-12 py-10 text-[#1f2937] shadow-2xl">
          <div className="text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">State of New York</div>
          <div className="mt-2 text-center text-[25px] font-bold tracking-tight">Residential Lease Agreement</div>
          <p className="mt-5 text-[12.5px] leading-relaxed text-slate-600">
            This lease is made on September 1, 2026, between Heights Properties LLC (“Landlord”) and Sam Rivera (“Tenant”) for
            Apartment 4B at 1 Main Street, Brooklyn, NY 11201.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg bg-slate-50 p-4 text-[12.5px] ring-1 ring-slate-200">
            {[['Monthly rent', '$2,450'], ['Term', '12 months'], ['Move-in', 'Sep 1, 2026'], ['Deposit', '$2,450']].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-slate-500">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-7 space-y-2.5">
            {[0.98, 0.92, 0.96, 0.7, 0, 0.95, 0.9, 0.97, 0.55].map((width, index) =>
              width ? <div key={index} className="h-[7px] rounded-full bg-slate-200" style={{ width: `${width * 100}%` }} /> : <div key={index} className="h-2" />,
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function KeysHud({ t }: { t: number }) {
  const hold = HOLDS.find(([from, to]) => t >= from - 220 && t < to + 320)
  if (!hold) return null
  const [from, to] = hold
  const shown = easeOut(span(t, from - 220, 240)) * (1 - ease(span(t, to + 60, 260)))
  const down = t >= from && t < to
  return (
    <div className="absolute inset-x-0 bottom-[46px] z-[80] flex justify-center" style={{ opacity: shown, transform: `translateY(${(1 - shown) * 18}px) scale(${mix(0.94, 1, shown)})` }}>
      <div className="flex items-center gap-3 rounded-[24px] bg-[#05070b]/75 py-3 pl-3 pr-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10 backdrop-blur-xl">
        <Key glyph="⌃" name="control" down={down} />
        <Key glyph="⌥" name="option" down={down} />
        <span className={cn('pl-2 text-[19px] font-medium tracking-tight', down ? 'text-dew' : 'text-white/60')}>{down ? 'Listening…' : 'Hold to talk'}</span>
      </div>
    </div>
  )
}

function Key({ glyph, name, down }: { glyph: string; name: string; down: boolean }) {
  return (
    <div
      className="flex h-[62px] w-[80px] flex-col justify-between rounded-[13px] px-3 py-2.5 text-white/90"
      style={{
        background: down ? 'linear-gradient(180deg, #232832, #1a1e26)' : 'linear-gradient(180deg, #2b303a, #1f232b)',
        transform: `translateY(${down ? 2 : 0}px)`,
        boxShadow: down
          ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1.5px rgba(94,234,212,0.75), 0 0 26px rgba(94,234,212,0.35)'
          : 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -3px 0 rgba(0,0,0,0.4), 0 6px 14px -6px rgba(0,0,0,0.8)',
      }}
    >
      <span className="self-end text-[20px] leading-none">{glyph}</span>
      <span className="text-[13px] leading-none text-white/55">{name}</span>
    </div>
  )
}

function Captions({ t }: { t: number }) {
  return (
    <div className="absolute bottom-[38px] left-[38px] z-[70]">
      {CAPTIONS.map((caption) => {
        let shown = t >= caption.from && t < caption.to ? (caption.n === 1 ? 1 : easeOut(span(t, caption.from + 80, 320))) * (1 - ease(span(t, caption.to - 240, 240))) : 0
        if (caption.n === 1 && t >= AT.reset) shown = easeOut(span(t, AT.reset + 40, 240))
        if (shown <= 0) return null
        return (
          <div
            key={caption.n}
            className="absolute bottom-0 left-0 flex items-center gap-3 whitespace-nowrap rounded-full bg-[#05070b]/70 py-2 pl-2 pr-5 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] ring-1 ring-white/10 backdrop-blur-xl"
            style={{ opacity: shown, transform: `translateY(${(1 - shown) * 14}px)` }}
          >
            <span className="brand-gradient grid size-9 place-items-center rounded-full text-[17px] font-bold text-slate-950">{caption.n}</span>
            <span className="text-[21px] font-semibold tracking-tight text-white">{caption.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function EndCard({ t }: { t: number }) {
  const backdrop = t < AT.reset ? ease(span(t, AT.end, 400)) : 1 - ease(span(t, AT.reset, 300))
  if (backdrop <= 0) return null
  const leaving = t < AT.reset ? span(t, AT.reset - 250, 250) : 1
  const rise = (order: number): React.CSSProperties => {
    const amount = easeOut(span(t, AT.end + 100 + order * 80, 550))
    return { opacity: amount * (1 - leaving), transform: `translateY(${(1 - amount) * 24}px)` }
  }
  return (
    <div className="absolute inset-0 z-[90] grid place-items-center overflow-hidden" style={{ opacity: backdrop }}>
      <div className="absolute inset-0 bg-[#04060b]/[0.95]" />
      <div className="absolute left-1/2 top-[38%] size-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2c58e6] opacity-25 blur-[150px]" />
      <div className="relative flex flex-col items-center text-center">
        <div style={rise(0)}>
          <Mascot mood="happy" size={124} />
        </div>
        <div style={rise(1)} className="text-gradient mt-5 text-[96px] font-bold leading-none tracking-[-0.045em]">Plip</div>
        <div style={rise(2)} className="mt-5 text-[27px] font-medium tracking-tight text-white/75">Ask your Mac. Plip shows you how, or just does it.</div>
        <div style={rise(3)} className="mt-8 flex gap-3">
          {['Free & open source', 'Uses the AI plan you already pay for', 'macOS 13+'].map((pill) => (
            <span key={pill} className="rounded-full bg-white/[0.06] px-4 py-2 text-[17px] font-medium text-white/80 ring-1 ring-white/10">{pill}</span>
          ))}
        </div>
        <div style={rise(4)} className="mt-9 font-mono text-[17px] text-white/40">github.com/hussainn7/plip-oss</div>
      </div>
    </div>
  )
}
