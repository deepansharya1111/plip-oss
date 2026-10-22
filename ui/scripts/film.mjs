// Render the README demo: plays src/film/Film.tsx frame by frame on a virtual clock, then encodes it with ffmpeg
// into the GIF, an MP4 to share, and the stills for the README's use cases (docs/img/use-*.jpg).
// Usage: npm run film [-- --gif ../docs/img/plip-demo.gif --mp4 shots/film/plip-demo.mp4 --width 800]
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const { values: args } = parseArgs({
  options: {
    gif: { type: 'string', default: resolve(root, '../docs/img/plip-demo.gif') },
    mp4: { type: 'string', default: resolve(root, 'shots/film/plip-demo.mp4') },
    frames: { type: 'string', default: resolve(root, 'shots/film/frames') },
    width: { type: 'string', default: '800' },
  },
})

// Time only moves when the recorder says so: timers, requestAnimationFrame and performance.now read a virtual
// clock, and CSS animations are paused and stepped to it, so every frame lands exactly 1/fps after the last.
function virtualClock() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  let frames = new Map()
  const realFrame = window.requestAnimationFrame.bind(window)
  const epoch = Date.now()
  performance.now = () => now
  Date.now = () => epoch + now
  window.setTimeout = (fn, delay = 0, ...rest) => {
    const id = nextId++
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn, rest, every: 0 })
    return id
  }
  window.setInterval = (fn, delay = 0, ...rest) => {
    const id = nextId++
    const every = Math.max(1, Number(delay) || 0)
    timers.set(id, { at: now + every, fn, rest, every })
    return id
  }
  window.clearTimeout = window.clearInterval = (id) => void timers.delete(id)
  window.requestAnimationFrame = (fn) => {
    const id = nextId++
    frames.set(id, fn)
    return id
  }
  window.cancelAnimationFrame = (id) => void frames.delete(id)
  // Without element.animate, Motion runs its animations in JS on the clock above instead of on the compositor.
  delete Element.prototype.animate

  const run = (fn, ...rest) => {
    try {
      fn(...rest)
    } catch (error) {
      console.error(error)
    }
  }
  const timersUntil = (target) => {
    for (;;) {
      let due = null
      for (const entry of timers) if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry
      if (!due) break
      const [id, timer] = due
      now = Math.max(now, timer.at)
      if (timer.every) timer.at += timer.every
      else timers.delete(id)
      if (typeof timer.fn === 'function') run(timer.fn, ...timer.rest)
    }
    now = target
  }
  const born = new WeakMap()
  window.__advance = (ms, steps = 2) => {
    const start = now
    for (let step = 1; step <= steps; step++) {
      timersUntil(start + (ms * step) / steps)
      const batch = frames
      frames = new Map()
      for (const fn of batch.values()) run(fn, now)
    }
    for (const animation of document.getAnimations()) {
      if (!born.has(animation)) {
        born.set(animation, now)
        animation.pause()
      }
      const time = now - born.get(animation)
      if (time >= (animation.effect?.getComputedTiming().endTime ?? Infinity)) animation.finish()
      else animation.currentTime = time
    }
  }
  // Two real frames (layout, resize observers) and a task (React's scheduler) so the page has caught up.
  window.__settle = () =>
    new Promise((done) =>
      realFrame(() =>
        realFrame(() => {
          const channel = new MessageChannel()
          channel.port1.onmessage = () => done()
          channel.port2.postMessage(0)
        }),
      ),
    )
}

const server = await createServer({ root, logLevel: 'error', server: { port: 0 } })
await server.listen()
const url = new URL('film.html', server.resolvedUrls.local[0]).href

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
await page.addInitScript(virtualClock)
await page.goto(url)
for (let tries = 0; !(await page.evaluate(() => window.__film?.ready)); tries++) {
  if (tries > 300) throw new Error('the film never got ready (fonts?)')
  await new Promise((done) => setTimeout(done, 50))
}

const { length, fps, stills } = await page.evaluate(() => window.__film)
const count = Math.round((length * fps) / 1000)
rmSync(args.frames, { recursive: true, force: true })
mkdirSync(args.frames, { recursive: true })
const started = Date.now()
for (let index = 0; index < count; index++) {
  if (index) await page.evaluate((ms) => window.__advance(ms), 1000 / fps)
  await page.evaluate(() => window.__settle())
  await page.screenshot({ path: resolve(args.frames, `${String(index).padStart(4, '0')}.png`) })
  if (index % 25 === 0) process.stdout.write(`\rframe ${index}/${count}`)
}
console.log(`\rrendered ${count} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`)
await browser.close()
await server.close()
if (errors.length) {
  console.error('page errors:\n' + [...new Set(errors)].join('\n'))
  process.exit(1)
}

const ffmpeg = (...argv) => {
  const result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', resolve(args.frames, '%04d.png'), ...argv], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${argv.at(-1)}`)
}
const megabytes = (path) => `${(statSync(path).size / 1e6).toFixed(1)} MB`
mkdirSync(dirname(args.gif), { recursive: true })
mkdirSync(dirname(args.mp4), { recursive: true })
// One palette for the whole film and an ordered dither, so still parts of the screen stay identical
// frame to frame and the GIF only stores what moved.
ffmpeg(
  '-vf', `scale=${args.width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  '-loop', '0', args.gif,
)
ffmpeg('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow', '-movflags', '+faststart', args.mp4)
console.log(`gif ${args.gif} (${megabytes(args.gif)})\nmp4 ${args.mp4} (${megabytes(args.mp4)})`)
for (const { name, at, crop } of stills) {
  const frame = resolve(args.frames, `${String(Math.round((at * fps) / 1000)).padStart(4, '0')}.png`)
  const out = resolve(dirname(args.gif), `${name}.jpg`)
  const result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', frame, '-vf', `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`, '-q:v', '3', out], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${out}`)
  console.log(`still ${out} (${megabytes(out)})`)
}
