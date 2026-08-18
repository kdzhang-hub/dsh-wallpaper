/**
 * dsh-wallpaper — host engine.
 *
 * Wallpaper Engine integration on Windows:
 *  - detects the Steam / Wallpaper Engine install by probing common roots and
 *    the Windows registry (`reg query`), then parsing `libraryfolders.vdf`
 *    for every Steam library the engine may live in;
 *  - scans downloaded wallpapers: workshop content (`steamapps/workshop/content/431960/*`)
 *    and local projects (`<weRoot>/projects/myprojects/*`), reading each
 *    `project.json` for title/type/preview/tags;
 *  - applies a wallpaper either through Wallpaper Engine's remote-control
 *    interface (`wallpaper64.exe -control openWallpaper -file <project.json>`,
 *    which is exactly what the GUI's Apply button does) or natively through
 *    SystemParametersInfo(SPI_SETDESKWALLPAPER) for static images;
 *  - reports the current native wallpaper (registry) and the per-monitor
 *    wallpapers Wallpaper Engine is currently showing (config.json).
 *
 * Everything is best-effort and never throws on discovery problems: a missing
 * engine degrades to "native mode only", never to a crash.
 */

import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { THEME_PRESETS, resolveThemePreset } from './presets.js'

const execFileAsync = promisify(execFile)

/** Wallpaper Engine's Steam app id (workshop content folder name). */
export const WE_APPID = '431960'

/** Image extensions we can serve as previews / set natively. */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'])

/** Error code used by HTTP adapters to report unsupported uploads as 415. */
export const UNSUPPORTED_IMAGE_FORMAT = 'UNSUPPORTED_IMAGE_FORMAT'

/** Image extensions SystemParametersInfo can reliably set as the desktop wallpaper. */
const NATIVE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp'])

/** Browser media formats used by the Harness backdrop. */
const HARNESS_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])

/** Preview images below this short side are not suitable for full-window cover. */
const LOW_QUALITY_SHORT_SIDE = 720

/** GIF loop shortening: hide the unreliable tail without losing the motion. */
const GIF_TAIL_RATIO = 0.15
const GIF_TAIL_MIN_MS = 120
const GIF_TAIL_MAX_MS = 300

/** Default opacity of the dark veil above a Harness wallpaper. */
export const DEFAULT_SKIN_SCRIM = 0.35
export const DEFAULT_PANEL_OPACITY = 0.52
export const DEFAULT_INPUT_OPACITY = 0.84
export const DEFAULT_BACKDROP_BLUR = 8
export const DEFAULT_ACCENT_COLOR = '#4f8cff'
export const DEFAULT_SECONDARY_ACCENT_COLOR = '#62c7a5'
export const DEFAULT_BRIGHTNESS = 1
export const DEFAULT_BACKGROUND_FIT = 'auto'
export const DEFAULT_MOTION_MODE = 'play'

/** Common Steam install roots probed when the registry is unreachable. */
const COMMON_STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Program Files (x86)\\Steam',
  'D:\\Steam',
  'E:\\Program Files (x86)\\Steam',
  'E:\\Steam',
  'F:\\Steam',
  'C:\\Steam',
]

/** Registry value names probed for the Steam install path. */
const STEAM_REGISTRY_KEYS = [
  ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
  ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ['HKCU\\SOFTWARE\\Valve\\Steam', 'SteamPath'],
]

/** Wallpaper Engine type aliases → a stable small vocabulary. */
function normalizeType(raw) {
  if (typeof raw !== 'string') return 'unknown'
  const type = raw.trim().toLowerCase()
  if (type === 'video' || type === 'video/wallpaper') return 'video'
  if (type === 'scene') return 'scene'
  if (type === 'web') return 'web'
  if (type === 'image' || type === 'picture' || type === 'photo') return 'image'
  if (type === 'audio' || type === 'music') return 'audio'
  if (type === 'application') return 'application'
  return type || 'unknown'
}

/** Read and JSON-parse a file; undefined on any failure. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Best-effort read of the Steam install path from the Windows registry. */
async function steamPathFromRegistry() {
  for (const [key, value] of STEAM_REGISTRY_KEYS) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 })
      const match = /REG_SZ\s+([^\r\n]+)/.exec(stdout)
      if (match !== null) {
        const path = match[1].trim()
        if (path.length > 0 && existsSync(path)) return path
      }
    } catch {
      // key missing or reg unavailable — try the next one
    }
  }
  return undefined
}

/**
 * Parse a Steam `libraryfolders.vdf` into its library paths.
 * Hand-written line parser (tolerates tabs/spaces, quoted values).
 */
function parseLibraryFolders(vdfPath) {
  let text
  try { text = readFileSync(vdfPath, 'utf8') } catch { return [] }
  const paths = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    // a `"path"  "D:\..."` entry
    const match = /^"path"\s+"([^"]+)"$/.exec(trimmed)
    if (match !== null) {
      const path = match[1].replace(/\\\\/g, '\\')
      if (path.length > 0 && existsSync(path)) paths.push(path)
    }
  }
  return paths
}

/**
 * Discover the Wallpaper Engine install dir and the workshop content dir.
 * @returns {{ installDir?: string, workshopDir?: string, steamLibs: string[] }}
 */
export async function discoverWallpaperEngine(overrides = {}) {
  if (overrides.installDir !== undefined && overrides.workshopDir !== undefined) {
    return {
      installDir: overrides.installDir,
      workshopDir: overrides.workshopDir,
      steamLibs: [dirname(dirname(dirname(overrides.workshopDir)))],
    }
  }

  const steamRoots = new Set(COMMON_STEAM_ROOTS)
  const registryPath = await steamPathFromRegistry()
  if (registryPath !== undefined) steamRoots.add(registryPath)

  const steamLibs = new Set()
  for (const root of steamRoots) {
    if (!existsSync(root)) continue
    steamLibs.add(root)
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    if (existsSync(vdf)) {
      for (const lib of parseLibraryFolders(vdf)) steamLibs.add(lib)
    }
  }

  let installDir
  let workshopDir
  for (const lib of steamLibs) {
    if (installDir === undefined) {
      const candidate = join(lib, 'steamapps', 'common', 'wallpaper_engine')
      if (existsSync(candidate)) installDir = candidate
    }
    if (workshopDir === undefined) {
      const candidate = join(lib, 'steamapps', 'workshop', 'content', WE_APPID)
      if (existsSync(candidate)) workshopDir = candidate
    }
  }

  return { installDir, workshopDir, steamLibs: [...steamLibs] }
}

/** Read common image dimensions from a bounded header without decoding the image. */
function readImageDimensions(path) {
  let descriptor
  try {
    const size = statSync(path).size
    const length = Math.min(size, 512 * 1024)
    const buffer = Buffer.alloc(length)
    descriptor = openSync(path, 'r')
    const bytes = readSync(descriptor, buffer, 0, length, 0)
    const data = buffer.subarray(0, bytes)
    const extension = extname(path).toLowerCase()
    if (extension === '.gif' && data.length >= 10 && data.toString('ascii', 0, 3) === 'GIF') {
      return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
    }
    if (extension === '.png' && data.length >= 24 && data.toString('ascii', 1, 4) === 'PNG') {
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    }
    if (extension === '.bmp' && data.length >= 26 && data.toString('ascii', 0, 2) === 'BM') {
      return { width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) }
    }
    if (extension === '.webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
      const kind = data.toString('ascii', 12, 16)
      if (kind === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) }
      if (kind === 'VP8 ' && data.length >= 30) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
      if (kind === 'VP8L' && data.length >= 25) {
        const bits = data.readUInt32LE(21)
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
      }
    }
    if ((extension === '.jpg' || extension === '.jpeg') && data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
      let offset = 2
      while (offset + 8 < data.length) {
        if (data[offset] !== 0xff) { offset += 1; continue }
        const marker = data[offset + 1]
        if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
        const segment = data.readUInt16BE(offset + 2)
        if (segment < 2 || offset + 2 + segment > data.length) break
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
        }
        offset += 2 + segment
      }
    }
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) try { closeSync(descriptor) } catch { /* best effort */ }
  }
  return undefined
}

/**
 * Read GIF animation timing without decoding image pixels. The parser only
 * accepts a bounded local preview and totals Graphic Control Extension delays.
 */
export function readGifAnimation(path) {
  try {
    if (extname(path).toLowerCase() !== '.gif') return undefined
    const size = statSync(path).size
    if (size < 13 || size > 64 * 1024 * 1024) return undefined
    const data = readFileSync(path)
    if (data.toString('ascii', 0, 3) !== 'GIF') return undefined
    let frames = 0
    let durationMs = 0
    for (let offset = 0; offset + 7 < data.length; offset += 1) {
      if (data[offset] !== 0x21 || data[offset + 1] !== 0xf9 || data[offset + 2] !== 0x04) continue
      // A zero GIF delay is rendered as a short delay by browsers; use 20ms
      // so the guard remains conservative instead of treating it as static.
      const delayMs = Math.max(20, data.readUInt16LE(offset + 4) * 10)
      frames += 1
      durationMs += delayMs
      offset += 7
    }
    if (frames < 2 || durationMs < 100) return undefined
    const cutMs = Math.min(
      Math.max(Math.round(durationMs * GIF_TAIL_RATIO), GIF_TAIL_MIN_MS),
      GIF_TAIL_MAX_MS,
      Math.max(1, Math.floor(durationMs * 0.4)),
    )
    return { kind: 'gif', frames, durationMs, cutMs, safeLoopMs: Math.max(1, durationMs - cutMs) }
  } catch {
    return undefined
  }
}

/** Pick the highest-resolution top-level preview/background candidate. */
function resolvePreview(dir, declared) {
  const candidates = []
  const seen = new Set()
  let realDir
  try { realDir = realpathSync(dir) } catch { return undefined }
  function add(name, priority = 0) {
    if (typeof name !== 'string' || name === '' || seen.has(name.toLowerCase())) return
    if (basename(name) !== name) return
    if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) return
    const full = join(dir, name)
    try {
      if (!statSync(full).isFile()) return
      const real = realpathSync(full)
      if (real !== realDir && !real.startsWith(realDir + sep)) return
    } catch { return }
    seen.add(name.toLowerCase())
    const dimensions = readImageDimensions(full)
    candidates.push({ name, dimensions, priority })
  }
  add(declared, 2)
  for (const name of ['wallpaper.jpg', 'wallpaper.png', 'background.jpg', 'background.png', 'preview.jpg', 'preview.png', 'preview.webp', 'preview.gif', 'cover.jpg', 'cover.png', 'thumb.jpg', 'thumbnail.jpg']) add(name, 1)
  try {
    for (const entry of readdirSync(dir)) {
      if (/^(preview|wallpaper|background|cover|thumb|thumbnail)/i.test(entry)) add(entry, 0)
    }
  } catch { /* unreadable dir */ }
  candidates.sort((a, b) => {
    const areaA = a.dimensions ? a.dimensions.width * a.dimensions.height : 0
    const areaB = b.dimensions ? b.dimensions.width * b.dimensions.height : 0
    return areaB - areaA || b.priority - a.priority
  })
  return candidates[0]
}

/** One scanned wallpaper record. */
function readWallpaper(dir, source, fallbackId) {
  const projectPath = join(dir, 'project.json')
  const project = readJson(projectPath)
  const title = typeof project?.title === 'string' && project.title !== ''
    ? project.title
    : (typeof project?.name === 'string' && project.name !== '' ? project.name : fallbackId)
  const type = normalizeType(project?.type)
  const tags = Array.isArray(project?.tags) ? project.tags.filter(t => typeof t === 'string') : []
  const preview = resolvePreview(dir, project?.preview)
  const previewRel = preview?.name
  let file
  if (typeof project?.file === 'string' && project.file !== '') file = project.file
  else {
    let entries = []
    try { entries = readdirSync(dir) } catch { /* unreadable */ }
    const video = entries.find(name => /\.(mp4|webm|mov)$/i.test(name))
    file = video ?? undefined
  }
  const sizeBytes = (() => {
    let total = 0
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        try { if (statSync(full).isFile()) total += statSync(full).size } catch { /* skip */ }
      }
    } catch { /* unreadable */ }
    return total
  })()
  const id = `${source}:${fallbackId}`
  const previewUrl = previewRel !== undefined
    ? `/api/dsh-wallpaper/preview?p=${encodeURIComponent(join(dir, previewRel))}`
    : undefined
  const videoExt = typeof file === 'string' ? extname(file).toLowerCase() : ''
  const isBrowserVideo = type === 'video' && HARNESS_VIDEO_EXTENSIONS.has(videoExt)
  const hasPreview = previewRel !== undefined
  const previewShortSide = preview?.dimensions ? Math.min(preview.dimensions.width, preview.dimensions.height) : undefined
  const previewQuality = previewShortSide !== undefined && previewShortSide < LOW_QUALITY_SHORT_SIDE ? 'low' : 'standard'
  const animation = previewRel !== undefined ? readGifAnimation(join(dir, previewRel)) : undefined
  const harness = isBrowserVideo
    ? {
        kind: 'video',
        mediaUrl: `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}`,
        posterUrl: hasPreview ? `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}&variant=poster` : undefined,
        compatible: true,
        status: 'native-video',
        previewWidth: preview?.dimensions?.width,
        previewHeight: preview?.dimensions?.height,
        quality: previewQuality,
      }
    : {
        kind: 'image',
        mediaUrl: hasPreview ? `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}` : undefined,
        posterUrl: hasPreview ? `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}` : undefined,
        compatible: hasPreview,
        status: hasPreview ? 'preview-fallback' : 'unavailable',
        previewWidth: preview?.dimensions?.width,
        previewHeight: preview?.dimensions?.height,
        quality: hasPreview ? previewQuality : 'unavailable',
        ...(animation === undefined ? {} : { animation }),
        fit: previewQuality === 'low' ? 'ambient' : 'cover',
        fallbackReason: hasPreview
          ? (type === 'scene'
              ? `Wallpaper Engine Scene 无法由浏览器直接解码，已使用${preview?.dimensions ? ` ${preview.dimensions.width}×${preview.dimensions.height}` : ''} 预览图${previewQuality === 'low' ? '（低清环境模式）' : ''}`
              : '浏览器不支持该项目格式，已使用预览图')
          : '没有可供 Harness 显示的浏览器媒体或预览图',
      }
  return {
    id,
    source,
    title,
    type,
    tags,
    file,
    preview: previewRel,
    previewUrl,
    harness,
    nativeReady: previewRel !== undefined && NATIVE_IMAGE_EXTENSIONS.has(extname(join(dir, previewRel)).toLowerCase()),
    dir,
    projectPath: existsSync(projectPath) ? projectPath : undefined,
    workshopId: typeof project?.workshopid === 'number' ? project.workshopid : undefined,
    sizeBytes,
  }
}

/**
 * The engine: owns discovery, the wallpaper index, and the apply operations.
 */
export class WallpaperEngine {
  constructor(options = {}) {
    this.options = options
    this.installDir = options.installDir
    this.workshopDir = options.workshopDir
    this.steamLibs = []
    this.uploadsDir = options.uploadsDir ?? join(homedir(), '.dsh', 'dsh-wallpaper', 'uploads')
    this.stateFile = options.stateFile ?? join(homedir(), '.dsh', 'dsh-wallpaper', 'skin-state.json')
    this.sceneCacheDir = options.sceneCacheDir ?? join(homedir(), '.dsh', 'dsh-wallpaper', 'scene-cache')
    this.repkgPath = options.repkgPath
    this.repkgSha256 = typeof options.repkgSha256 === 'string' && /^[0-9a-f]{64}$/i.test(options.repkgSha256)
      ? options.repkgSha256.toLowerCase()
      : undefined
    this.repkgFingerprint = undefined
    this.discovered = false
    this.skinMutation = Promise.resolve()
    this.libraryRevision = 0
    this.libraryWatchers = []
    this.libraryWatchReady = false
    this.libraryChangeTimer = undefined
    this.libraryWaiters = new Set()
    this.nativeHelper = join(homedir(), '.dsh', 'dsh-wallpaper', 'native-set.ps1')
    try { mkdirSync(this.uploadsDir, { recursive: true }) } catch { /* best effort */ }
    try { mkdirSync(dirname(this.nativeHelper), { recursive: true }) } catch { /* best effort */ }
    try { mkdirSync(dirname(this.stateFile), { recursive: true }) } catch { /* best effort */ }
    try { mkdirSync(this.sceneCacheDir, { recursive: true }) } catch { /* best effort */ }
  }

  /** Bounded streaming hash of the explicitly configured local helper. */
  helperFingerprint() {
    if (typeof this.repkgPath !== 'string' || !existsSync(this.repkgPath)) return undefined
    try {
      const stat = statSync(this.repkgPath)
      if (!stat.isFile() || stat.size > 1024 * 1024 * 1024) return undefined
      const stamp = `${stat.size}:${stat.mtimeMs}`
      if (this.repkgFingerprint?.stamp === stamp) return this.repkgFingerprint.hash
      const handle = openSync(this.repkgPath, 'r')
      const hash = createHash('sha256')
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      try {
        let offset = 0
        while (offset < stat.size) {
          const bytes = readSync(handle, buffer, 0, Math.min(buffer.length, stat.size - offset), offset)
          if (bytes <= 0) break
          hash.update(buffer.subarray(0, bytes))
          offset += bytes
        }
      } finally { closeSync(handle) }
      const value = hash.digest('hex')
      this.repkgFingerprint = { stamp, hash: value }
      return value
    } catch { return undefined }
  }

  /** (Re)discover the engine locations. Idempotent and never throws. */
  async ensureDiscovered() {
    if (this.discovered) return
    const found = await discoverWallpaperEngine(this.options)
    if (this.options.installDir !== undefined) found.installDir = this.options.installDir
    if (this.options.workshopDir !== undefined) found.workshopDir = this.options.workshopDir
    this.installDir = found.installDir
    this.workshopDir = found.workshopDir
    this.steamLibs = found.steamLibs
    this.discovered = true
  }

  /** Start best-effort file notifications for new/changed local wallpapers. */
  async startLibraryWatch() {
    await this.ensureDiscovered()
    if (this.libraryWatchReady) return
    this.libraryWatchReady = true
    const roots = [
      this.workshopDir,
      this.installDir === undefined ? undefined : join(this.installDir, 'projects', 'myprojects'),
      this.uploadsDir,
    ]
    for (const root of roots) {
      if (typeof root !== 'string' || !existsSync(root)) continue
      try {
        const watcher = watch(root, { persistent: false, recursive: process.platform === 'win32' }, () => this.scheduleLibraryChange())
        watcher.on('error', () => { try { watcher.close() } catch { /* best effort */ } })
        this.libraryWatchers.push(watcher)
      } catch { /* network drives and older Node builds may not support watch */ }
    }
  }

  scheduleLibraryChange() {
    if (this.libraryChangeTimer !== undefined) clearTimeout(this.libraryChangeTimer)
    this.libraryChangeTimer = setTimeout(() => {
      this.libraryChangeTimer = undefined
      this.libraryRevision += 1
      for (const waiter of this.libraryWaiters) waiter.finish({ revision: this.libraryRevision, changed: true, watching: this.libraryWatchers.length > 0 })
    }, 450)
  }

  /** Version exposed to the client before it starts a bounded long poll. */
  async librarySnapshot() {
    await this.startLibraryWatch()
    return { revision: this.libraryRevision, watching: this.libraryWatchers.length > 0 }
  }

  /** Resolve when a watched directory changes, on timeout, or when aborted. */
  async waitForLibraryChange(since, timeoutMs = 25000, signal) {
    const snapshot = await this.librarySnapshot()
    const requested = Number.isSafeInteger(since) && since >= 0 ? since : 0
    if (requested !== snapshot.revision || signal?.aborted) return { ...snapshot, changed: requested !== snapshot.revision, aborted: signal?.aborted === true }
    const waitMs = Math.max(1000, Math.min(25000, Number.isFinite(timeoutMs) ? Math.round(timeoutMs) : 25000))
    return await new Promise(resolve => {
      let timer
      const waiter = {
        finish: (result) => {
          if (!this.libraryWaiters.delete(waiter)) return
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve(result)
        },
      }
      const onAbort = () => waiter.finish({ revision: this.libraryRevision, changed: false, watching: this.libraryWatchers.length > 0, aborted: true })
      timer = setTimeout(() => waiter.finish({ revision: this.libraryRevision, changed: false, watching: this.libraryWatchers.length > 0 }), waitMs)
      this.libraryWaiters.add(waiter)
      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Close non-persistent watchers promptly when the Cordis plugin reloads. */
  close() {
    if (this.libraryChangeTimer !== undefined) clearTimeout(this.libraryChangeTimer)
    this.libraryChangeTimer = undefined
    for (const watcher of this.libraryWatchers) { try { watcher.close() } catch { /* best effort */ } }
    this.libraryWatchers = []
    this.libraryWatchReady = false
    for (const waiter of this.libraryWaiters) waiter.finish({ revision: this.libraryRevision, changed: false, watching: false, aborted: true })
  }

  /** Scan all wallpapers (workshop + local projects). Never throws. */
  async list() {
    await this.ensureDiscovered()
    const wallpapers = []
    const seen = new Set()
    const add = (wallpaper) => {
      if (seen.has(wallpaper.id)) return
      seen.add(wallpaper.id)
      wallpapers.push(wallpaper)
    }
    if (this.workshopDir !== undefined && existsSync(this.workshopDir)) {
      let entries = []
      try { entries = readdirSync(this.workshopDir) } catch { /* directory disappeared */ }
      for (const entry of entries) {
        const dir = join(this.workshopDir, entry)
        try {
          if (!statSync(dir).isDirectory()) continue
          add(readWallpaper(dir, 'workshop', entry))
        } catch { /* entry disappeared during scan */ }
      }
    }
    if (this.installDir !== undefined) {
      const myprojects = join(this.installDir, 'projects', 'myprojects')
      if (existsSync(myprojects)) {
        let entries = []
        try { entries = readdirSync(myprojects) } catch { /* directory disappeared */ }
        for (const entry of entries) {
          const dir = join(myprojects, entry)
          try {
            if (!statSync(dir).isDirectory()) continue
            add(readWallpaper(dir, 'local', entry))
          } catch { /* entry disappeared during scan */ }
        }
      }
    }
    let uploads = []
    try { uploads = readdirSync(this.uploadsDir) } catch { /* uploads unavailable */ }
    for (const filename of uploads) {
      const full = join(this.uploadsDir, filename)
      try {
        if (!statSync(full).isFile() || !IMAGE_EXTENSIONS.has(extname(filename).toLowerCase())) continue
        const id = `local-file:${filename}`
        const animation = readGifAnimation(full)
        const dimensions = readImageDimensions(full)
        const shortSide = dimensions ? Math.min(dimensions.width, dimensions.height) : undefined
        add({
          id,
          source: 'local-file',
          title: filename.replace(/\.[^.]+$/, ''),
          type: 'image',
          tags: ['本地上传'],
          file: filename,
          preview: filename,
          previewUrl: `/api/dsh-wallpaper/preview?p=${encodeURIComponent(full)}`,
          harness: {
            kind: 'image',
            mediaUrl: `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}`,
            posterUrl: `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}`,
            compatible: true,
            status: 'native-image',
            previewWidth: dimensions?.width,
            previewHeight: dimensions?.height,
            quality: shortSide !== undefined && shortSide < LOW_QUALITY_SHORT_SIDE ? 'low' : 'standard',
            fit: shortSide !== undefined && shortSide < LOW_QUALITY_SHORT_SIDE ? 'ambient' : 'cover',
            ...(animation === undefined ? {} : { animation }),
          },
          nativeReady: NATIVE_IMAGE_EXTENSIONS.has(extname(filename).toLowerCase()),
          dir: this.uploadsDir,
          projectPath: undefined,
          sizeBytes: statSync(full).size,
        })
      } catch { /* upload disappeared during scan */ }
    }
    wallpapers.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    return wallpapers
  }

  /** Root directories the preview route may serve files from. */
  allowedPreviewRoots() {
    const roots = [this.uploadsDir]
    if (this.workshopDir !== undefined) roots.push(this.workshopDir)
    if (this.installDir !== undefined) roots.push(this.installDir)
    return roots.filter(root => root !== undefined)
  }

  /** True when the path sits under one of the allowed preview roots. */
  isAllowedPath(path) {
    let resolved
    try {
      resolved = realpathSync.native(path)
      if (!statSync(resolved).isFile()) return false
    } catch { return false }
    for (const root of this.allowedPreviewRoots()) {
      let rootResolved
      try { rootResolved = realpathSync.native(root) } catch { continue }
      if (this.pathInside(resolved, rootResolved)) return true
    }
    return false
  }

  /** Real-path containment check (case-insensitive on Windows). */
  pathInside(path, root) {
    const normalizeCase = value => process.platform === 'win32' ? value.toLowerCase() : value
    const candidate = normalizeCase(resolve(normalize(path)))
    const base = normalizeCase(resolve(normalize(root)))
    return candidate === base || candidate.startsWith(base + sep)
  }

  /** Resolve an existing file and reject junction/symlink escapes. */
  safeMediaPath(path, wallpaperDir) {
    if (typeof path !== 'string' || path === '') return undefined
    try {
      const real = realpathSync.native(path)
      const realDir = realpathSync.native(wallpaperDir)
      if (!statSync(real).isFile() || !this.pathInside(real, realDir)) return undefined
      return real
    } catch { return undefined }
  }

  /** Resolve a media URL by scanned wallpaper id only. */
  async resolveHarnessMedia(id, variant = 'media') {
    if (typeof id !== 'string' || id === '') return undefined
    const wallpaper = (await this.list()).find(item => item.id === id)
    if (wallpaper === undefined || wallpaper.harness?.compatible !== true) return undefined
    const previewPath = wallpaper.preview !== undefined
      ? this.safeMediaPath(join(wallpaper.dir, wallpaper.preview), wallpaper.dir)
      : undefined
    if (variant === 'poster') {
      if (previewPath === undefined) return undefined
      return { path: previewPath, wallpaper, kind: 'image' }
    }
    if (wallpaper.harness.kind === 'video' && typeof wallpaper.file === 'string') {
      const mediaPath = this.safeMediaPath(join(wallpaper.dir, wallpaper.file), wallpaper.dir)
      if (mediaPath !== undefined && HARNESS_VIDEO_EXTENSIONS.has(extname(mediaPath).toLowerCase())) {
        return { path: mediaPath, wallpaper, kind: 'video' }
      }
    }
    if (previewPath !== undefined) return { path: previewPath, wallpaper, kind: 'image' }
    return undefined
  }

  /** Read the host-wide Harness skin state without trusting its contents. */
  readStoredSkinState() {
    const fallback = {
      revision: 0,
      schemaVersion: 2,
      wallpaperId: null,
      enabled: false,
      scrim: DEFAULT_SKIN_SCRIM,
      panelOpacity: DEFAULT_PANEL_OPACITY,
      inputOpacity: DEFAULT_INPUT_OPACITY,
      blur: DEFAULT_BACKDROP_BLUR,
      paletteMode: 'auto',
      accentColor: DEFAULT_ACCENT_COLOR,
      secondaryAccentColor: DEFAULT_SECONDARY_ACCENT_COLOR,
      brightness: DEFAULT_BRIGHTNESS,
      backgroundFit: DEFAULT_BACKGROUND_FIT,
      motionMode: DEFAULT_MOTION_MODE,
      presetId: null,
      sceneBridgeEnabled: false,
      updatedAt: null,
    }
    if (!existsSync(this.stateFile)) return { exists: false, state: fallback }
    const raw = readJson(this.stateFile)
    if (raw === undefined) return { exists: true, state: fallback }
    return {
      exists: true,
      state: {
        revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
        schemaVersion: 2,
        wallpaperId: typeof raw.wallpaperId === 'string' && raw.wallpaperId !== '' ? raw.wallpaperId : null,
        enabled: raw.enabled === true,
        scrim: typeof raw.scrim === 'number' && Number.isFinite(raw.scrim) && raw.scrim >= 0 && raw.scrim <= 1
          ? raw.scrim
          : DEFAULT_SKIN_SCRIM,
        panelOpacity: typeof raw.panelOpacity === 'number' && Number.isFinite(raw.panelOpacity) && raw.panelOpacity >= 0.15 && raw.panelOpacity <= 0.9
          ? raw.panelOpacity
          : DEFAULT_PANEL_OPACITY,
        inputOpacity: typeof raw.inputOpacity === 'number' && Number.isFinite(raw.inputOpacity) && raw.inputOpacity >= 0.3 && raw.inputOpacity <= 1
          ? raw.inputOpacity
          : DEFAULT_INPUT_OPACITY,
        blur: typeof raw.blur === 'number' && Number.isFinite(raw.blur) && raw.blur >= 0 && raw.blur <= 32
          ? raw.blur
          : DEFAULT_BACKDROP_BLUR,
        paletteMode: raw.paletteMode === 'manual' ? 'manual' : 'auto',
        accentColor: typeof raw.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accentColor)
          ? raw.accentColor.toLowerCase()
          : DEFAULT_ACCENT_COLOR,
        secondaryAccentColor: typeof raw.secondaryAccentColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.secondaryAccentColor)
          ? raw.secondaryAccentColor.toLowerCase()
          : DEFAULT_SECONDARY_ACCENT_COLOR,
        brightness: typeof raw.brightness === 'number' && Number.isFinite(raw.brightness) && raw.brightness >= 0.5 && raw.brightness <= 1.5
          ? raw.brightness
          : DEFAULT_BRIGHTNESS,
        backgroundFit: raw.backgroundFit === 'cover' || raw.backgroundFit === 'contain' ? raw.backgroundFit : DEFAULT_BACKGROUND_FIT,
        motionMode: raw.motionMode === 'static' ? 'static' : DEFAULT_MOTION_MODE,
        presetId: typeof raw.presetId === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(raw.presetId) ? raw.presetId : null,
        sceneBridgeEnabled: raw.sceneBridgeEnabled === true,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      },
    }
  }

  /** Atomic same-directory state replacement. */
  writeSkinState(state) {
    mkdirSync(dirname(this.stateFile), { recursive: true })
    const temp = join(dirname(this.stateFile), `.${basename(this.stateFile)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
      renameSync(temp, this.stateFile)
    } catch (error) {
      try { if (existsSync(temp)) unlinkSync(temp) } catch { /* best effort */ }
      throw error
    }
  }

  /** Shared state plus the currently resolved wallpaper/media descriptor. */
  async getSkin() {
    let stored = this.readStoredSkinState()
    let wallpaper
    if (stored.state.wallpaperId !== null) {
      wallpaper = (await this.list()).find(item => item.id === stored.state.wallpaperId)
    }
    if (stored.state.enabled && (wallpaper === undefined || wallpaper.harness?.compatible !== true)) {
      const safe = {
        ...stored.state,
        revision: stored.state.revision + 1,
        wallpaperId: null,
        enabled: false,
        updatedAt: new Date().toISOString(),
      }
      this.writeSkinState(safe)
      stored = { exists: true, state: safe }
      wallpaper = undefined
    }
    return {
      exists: stored.exists,
      ...stored.state,
      preset: resolveThemePreset(stored.state.presetId) ?? null,
      presets: THEME_PRESETS,
      sceneBridge: this.sceneBridgeStatus(stored.state),
      wallpaper: wallpaper === undefined ? null : {
        id: wallpaper.id,
        title: wallpaper.title,
        type: wallpaper.type,
        previewUrl: wallpaper.previewUrl,
        harness: wallpaper.harness,
      },
    }
  }

  /** Report only the managed Scene bridge state; never probe arbitrary paths. */
  sceneBridgeStatus(state = this.readStoredSkinState().state) {
    const configured = typeof this.repkgPath === 'string' && this.repkgPath !== ''
    const hash = configured ? this.helperFingerprint() : undefined
    const available = hash !== undefined && (this.repkgSha256 === undefined || this.repkgSha256 === hash)
    return {
      enabled: state.sceneBridgeEnabled === true,
      available,
      mode: available ? 'local-helper' : 'unavailable',
      cacheReady: existsSync(this.sceneCacheDir),
      hashVerified: this.repkgSha256 === undefined ? configured && hash !== undefined : this.repkgSha256 === hash,
      message: available
        ? '已检测到本地 RePKG helper；可用于受控 Scene 提取。'
        : (configured && hash !== undefined ? '本地 RePKG helper 的 SHA-256 与配置不匹配，已拒绝使用。' : '高清 Scene 桥尚未配置。公开 Release 清单发布前不会下载或运行未知程序。'),
    }
  }

  /** Controlled bridge state. Download/install is deliberately fail-closed. */
  async updateSceneBridge(input = {}) {
    const action = input.action
    const stored = this.readStoredSkinState().state
    if (!['install', 'enable', 'disable', 'extract', 'clear-cache'].includes(action)) {
      return { ok: false, status: 400, error: 'unsupported scene bridge action' }
    }
    if (action === 'install') {
      return { ok: false, status: 503, error: '受信任 RePKG Release 清单尚未发布；不会下载未知可执行文件', bridge: this.sceneBridgeStatus(stored) }
    }
    if (action === 'clear-cache') {
      try {
        rmSync(this.sceneCacheDir, { recursive: true, force: true, maxRetries: 2 })
        mkdirSync(this.sceneCacheDir, { recursive: true })
      } catch (error) {
        return { ok: false, status: 500, error: error instanceof Error ? error.message : String(error) }
      }
      return { ok: true, status: 200, bridge: this.sceneBridgeStatus(stored) }
    }
    if (action === 'extract') {
      if (typeof input.id !== 'string' || input.id.length === 0 || input.id.length > 512) {
        return { ok: false, status: 400, error: 'extract requires a scanned Scene wallpaper id', bridge: this.sceneBridgeStatus(stored) }
      }
      const wallpaper = (await this.list()).find(item => item.id === input.id)
      if (wallpaper === undefined || wallpaper.type !== 'scene' || typeof wallpaper.file !== 'string' || extname(wallpaper.file).toLowerCase() !== '.pkg') {
        return { ok: false, status: 400, error: 'extract accepts only a scanned Scene package', bridge: this.sceneBridgeStatus(stored) }
      }
      if (this.safeMediaPath(join(wallpaper.dir, wallpaper.file), wallpaper.dir) === undefined) {
        return { ok: false, status: 400, error: 'Scene package path is no longer safe', bridge: this.sceneBridgeStatus(stored) }
      }
      if (!this.sceneBridgeStatus(stored).available) {
        return { ok: false, status: 409, error: '未配置可信的本地 RePKG helper', bridge: this.sceneBridgeStatus(stored) }
      }
      // The public helper manifest is intentionally absent in this checkout.
      // Do not guess a CLI version or execute an unpinned binary.
      return { ok: false, status: 503, error: 'Scene 提取将在带版本与 SHA-256 清单的公开 helper 发布后启用', bridge: this.sceneBridgeStatus(stored) }
    }
    if (!this.sceneBridgeStatus(stored).available) {
      return { ok: false, status: 409, error: '未配置可信的本地 RePKG helper', bridge: this.sceneBridgeStatus(stored) }
    }
    const next = { ...stored, schemaVersion: 2, revision: stored.revision + 1, sceneBridgeEnabled: action === 'enable', updatedAt: new Date().toISOString() }
    this.writeSkinState(next)
    return { ok: true, status: 200, bridge: this.sceneBridgeStatus(next), skin: await this.getSkin() }
  }

  /** Apply, adjust, randomize, or clear the Harness wallpaper. */
  updateSkin(input = {}) {
    const mutation = this.skinMutation.then(() => this.performUpdateSkin(input))
    this.skinMutation = mutation.catch(() => undefined)
    return mutation
  }

  async performUpdateSkin(input = {}) {
    const stored = this.readStoredSkinState()
    const current = stored.state
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      return { ok: false, status: 409, error: `revision conflict: current revision is ${current.revision}`, skin: await this.getSkin() }
    }
    if (input.scrim !== undefined && (typeof input.scrim !== 'number' || !Number.isFinite(input.scrim) || input.scrim < 0 || input.scrim > 1)) {
      return { ok: false, status: 400, error: 'scrim must be a number between 0 and 1' }
    }
    if (input.panelOpacity !== undefined && (typeof input.panelOpacity !== 'number' || !Number.isFinite(input.panelOpacity) || input.panelOpacity < 0.15 || input.panelOpacity > 0.9)) {
      return { ok: false, status: 400, error: 'panelOpacity must be a number between 0.15 and 0.9' }
    }
    if (input.inputOpacity !== undefined && (typeof input.inputOpacity !== 'number' || !Number.isFinite(input.inputOpacity) || input.inputOpacity < 0.3 || input.inputOpacity > 1)) {
      return { ok: false, status: 400, error: 'inputOpacity must be a number between 0.3 and 1' }
    }
    if (input.blur !== undefined && (typeof input.blur !== 'number' || !Number.isFinite(input.blur) || input.blur < 0 || input.blur > 32)) {
      return { ok: false, status: 400, error: 'blur must be a number between 0 and 32' }
    }
    if (input.brightness !== undefined && (typeof input.brightness !== 'number' || !Number.isFinite(input.brightness) || input.brightness < 0.5 || input.brightness > 1.5)) {
      return { ok: false, status: 400, error: 'brightness must be a number between 0.5 and 1.5' }
    }
    if (input.backgroundFit !== undefined && !['auto', 'cover', 'contain'].includes(input.backgroundFit)) {
      return { ok: false, status: 400, error: 'backgroundFit must be auto, cover, or contain' }
    }
    if (input.motionMode !== undefined && !['play', 'static'].includes(input.motionMode)) {
      return { ok: false, status: 400, error: 'motionMode must be play or static' }
    }
    if (input.presetId !== undefined && input.presetId !== null && resolveThemePreset(input.presetId) === undefined) {
      return { ok: false, status: 400, error: 'presetId must name an installed safe preset' }
    }
    if (input.paletteMode !== undefined && input.paletteMode !== 'auto' && input.paletteMode !== 'manual') {
      return { ok: false, status: 400, error: 'paletteMode must be auto or manual' }
    }
    if (input.accentColor !== undefined && (typeof input.accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.accentColor))) {
      return { ok: false, status: 400, error: 'accentColor must be a six-digit hex color' }
    }
    if (input.secondaryAccentColor !== undefined && (typeof input.secondaryAccentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.secondaryAccentColor))) {
      return { ok: false, status: 400, error: 'secondaryAccentColor must be a six-digit hex color' }
    }

    const action = input.action === 'random' ? 'random'
      : (input.action === 'clear' || input.enabled === false ? 'clear' : 'apply')
    let wallpaperId = current.wallpaperId
    let enabled = current.enabled
    if (action === 'clear') {
      wallpaperId = null
      enabled = false
    } else {
      let wallpaper
      if (action === 'random') {
        const compatible = (await this.list()).filter(item => item.harness?.compatible === true)
        if (compatible.length === 0) return { ok: false, status: 404, error: '没有可用于 Harness 的壁纸' }
        wallpaper = compatible[Math.floor(Math.random() * compatible.length)]
      } else if (typeof input.id === 'string' && input.id !== '') {
        wallpaper = (await this.list()).find(item => item.id === input.id)
      } else if (wallpaperId !== null) {
        wallpaper = (await this.list()).find(item => item.id === wallpaperId)
      }
      if (wallpaper === undefined && (typeof input.id === 'string' || input.enabled === true || current.enabled)) {
        return { ok: false, status: 404, error: `未找到壁纸：${input.id ?? wallpaperId ?? ''}` }
      }
      if (wallpaper !== undefined && wallpaper.harness?.compatible !== true) {
        return { ok: false, status: 400, error: wallpaper.harness?.fallbackReason ?? '该壁纸不兼容 Harness 背景' }
      }
      if (wallpaper !== undefined) {
        wallpaperId = wallpaper.id
        enabled = true
      }
    }

    const next = {
      schemaVersion: 2,
      revision: current.revision + 1,
      wallpaperId,
      enabled,
      scrim: input.scrim ?? current.scrim,
      panelOpacity: input.panelOpacity ?? current.panelOpacity,
      inputOpacity: input.inputOpacity ?? current.inputOpacity,
      blur: input.blur ?? current.blur,
      paletteMode: input.paletteMode ?? current.paletteMode,
      accentColor: input.accentColor?.toLowerCase() ?? current.accentColor,
      secondaryAccentColor: input.secondaryAccentColor?.toLowerCase() ?? current.secondaryAccentColor,
      brightness: input.brightness ?? current.brightness,
      backgroundFit: input.backgroundFit ?? current.backgroundFit,
      motionMode: input.motionMode ?? current.motionMode,
      presetId: input.presetId !== undefined ? input.presetId : (resolveThemePreset(current.presetId) ? current.presetId : null),
      sceneBridgeEnabled: input.sceneBridgeEnabled ?? current.sceneBridgeEnabled,
      updatedAt: new Date().toISOString(),
    }
    this.writeSkinState(next)
    return { ok: true, status: 200, skin: await this.getSkin() }
  }

  async applyHarness(id, scrim, appearance = {}) {
    return this.updateSkin({ action: 'apply', id, scrim, ...appearance })
  }

  async randomHarness(scrim, appearance = {}) {
    return this.updateSkin({ action: 'random', scrim, ...appearance })
  }

  async clearHarness() {
    return this.updateSkin({ action: 'clear' })
  }

  /** Apply a wallpaper through the Wallpaper Engine remote-control interface. */
  applyWithEngine(projectPath) {
    if (this.installDir === undefined) {
      return { ok: false, mode: 'we', error: '未找到 Wallpaper Engine 安装目录' }
    }
    const exe = join(this.installDir, 'wallpaper64.exe')
    if (!existsSync(exe)) {
      return { ok: false, mode: 'we', error: `未找到 wallpaper64.exe：${exe}` }
    }
    if (!existsSync(projectPath)) {
      return { ok: false, mode: 'we', error: `壁纸项目不存在：${projectPath}` }
    }
    try {
      // Remote control: the running (or freshly started) engine opens this
      // wallpaper. Detached so the call never blocks on the engine's lifetime.
      const child = spawn(exe, ['-control', 'openWallpaper', '-file', projectPath], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return { ok: true, mode: 'we', message: `已通过 Wallpaper Engine 应用：${basename(projectPath)}` }
    } catch (error) {
      return { ok: false, mode: 'we', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Ensure the native-set PowerShell helper exists on disk. */
  ensureNativeHelper() {
    if (existsSync(this.nativeHelper)) return
    const script = [
      'param([string]$Path)',
      'Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class DshWallpaperNative {',
      '  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
      '  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);',
      '}',
      '"@ -ErrorAction Stop',
      // SPI_SETDESKWALLPAPER=20; try persist+notify (3), then notify-only (2);
      // fall back to a raw registry write + notify when the API refuses.
      '$r = [DshWallpaperNative]::SystemParametersInfo(20, 0, $Path, 3)',
      'if ($r -eq 0) { $r = [DshWallpaperNative]::SystemParametersInfo(20, 0, $Path, 2) }',
      'if ($r -eq 0) {',
      '  try {',
      '    New-Item -Path "HKCU:\\Control Panel\\Desktop" -Force | Out-Null',
      '    Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name WallPaper -Value $Path -Type String',
      '    [DshWallpaperNative]::SystemParametersInfo(20, 0, $null, 2) | Out-Null',
      '    $r = 1',
      '  } catch { $r = 0 }',
      '}',
      'Write-Output $r',
    ].join('\n')
    try {
      writeFileSync(this.nativeHelper, script, 'utf8')
    } catch {
      this.nativeHelper = undefined
    }
  }

  /** Set the Windows desktop wallpaper to a static image file. */
  async applyNative(imagePath) {
    if (typeof imagePath !== 'string' || imagePath === '' || !existsSync(imagePath)) {
      return { ok: false, mode: 'native', error: `图片文件不存在：${imagePath}` }
    }
    if (!NATIVE_IMAGE_EXTENSIONS.has(extname(imagePath).toLowerCase())) {
      return { ok: false, mode: 'native', error: `不是原生桌面支持的图片格式（仅 jpg/png/bmp/webp）：${extname(imagePath)}` }
    }
    this.ensureNativeHelper()
    const escaped = imagePath.replace(/'/g, "''")
    const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']
    if (this.nativeHelper !== undefined) {
      psArgs.push('-File', this.nativeHelper, '-Path', imagePath)
    } else {
      // No writable helper location: fall back to inline Add-Type.
      psArgs.push('-Command', `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DshWpN2 { [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int SystemParametersInfo(int a,int b,string c,int d); }' ; [DshWpN2]::SystemParametersInfo(20,0,'${escaped}',3)`)
    }
    try {
      const { stdout } = await execFileAsync('powershell.exe', psArgs, { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 })
      const result = stdout.trim().split(/\r?\n/).pop() ?? ''
      if (result === '1' || result === 'True') {
        return { ok: true, mode: 'native', message: `已设为 Windows 桌面壁纸：${basename(imagePath)}` }
      }
      return { ok: false, mode: 'native', error: 'SystemParametersInfo 调用失败（可能被系统策略拦截）' }
    } catch (error) {
      return { ok: false, mode: 'native', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Apply a wallpaper.
   * @param id - scanned wallpaper id (`workshop:<n>` / `local:<name>`) or
   *             `local-file:<name>` for an uploaded image.
   * @param mode - 'we' (default for engine wallpapers), 'native', or 'random'.
   */
  async apply(id, mode = 'we') {
    if (mode === 'random') {
      const all = await this.list()
      if (all.length === 0) return { ok: false, error: '没有可用的壁纸' }
      const pick = all[Math.floor(Math.random() * all.length)]
      return this.apply(pick.id, 'we')
    }
    if (mode === 'native') {
      // resolveImageFor is async — await it, or imagePath would be a Promise
      // object and the error string would read "图片文件不存在：[object Promise]".
      const imagePath = await this.resolveImageFor(id)
      if (imagePath === undefined) {
        return { ok: false, mode: 'native', error: '该壁纸没有可用的静态图片（gif 预览不能直接设为桌面），请用「WE 应用」或选择一张 jpg/png 图片' }
      }
      return this.applyNative(imagePath)
    }
    // WE mode: resolve the wallpaper to its project.json (or a media file).
    const wallpaper = (await this.list()).find(item => item.id === id)
    if (wallpaper === undefined) return { ok: false, mode: 'we', error: `未找到壁纸：${id}` }
    const target = wallpaper.projectPath ?? (wallpaper.dir ? join(wallpaper.dir, wallpaper.file ?? '') : undefined)
    if (target === undefined || !existsSync(target)) {
      return { ok: false, mode: 'we', error: `壁纸项目文件缺失：${target}` }
    }
    return this.applyWithEngine(target)
  }

  /** Resolve a wallpaper id or absolute path to a static image file (native-capable). */
  async resolveImageFor(idOrPath) {
    if (typeof idOrPath === 'string' && existsSync(idOrPath) && NATIVE_IMAGE_EXTENSIONS.has(extname(idOrPath).toLowerCase())) {
      return idOrPath
    }
    const all = await this.list()
    const wallpaper = all.find(item => item.id === idOrPath)
    if (wallpaper === undefined) return undefined
    if (wallpaper.preview !== undefined) {
      const previewPath = join(wallpaper.dir, wallpaper.preview)
      if (NATIVE_IMAGE_EXTENSIONS.has(extname(previewPath).toLowerCase())) return previewPath
    }
    // No static (jpg/png/bmp/webp) preview: gif previews and video/scene
    // wallpapers cannot be set natively.
    return undefined
  }

  /** Save an uploaded image into the managed uploads dir; returns the record. */
  saveUpload(name, buffer) {
    const safeName = basename(name).replace(/[^\w.\-\u4e00-\u9fff ]+/g, '_')
    const extension = extname(safeName).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(extension)) {
      const error = new Error('不支持的图片格式；请选择 JPG、PNG、BMP、GIF 或 WebP')
      error.code = UNSUPPORTED_IMAGE_FORMAT
      throw error
    }
    const filename = `${Date.now()}-${randomBytes(3).toString('hex')}-${safeName}`
    const full = join(this.uploadsDir, filename)
    writeFileSync(full, buffer)
    const id = `local-file:${filename}`
    const animation = readGifAnimation(full)
    const dimensions = readImageDimensions(full)
    const shortSide = dimensions ? Math.min(dimensions.width, dimensions.height) : undefined
    const record = {
      id,
      source: 'local-file',
      title: safeName.replace(/\.[^.]+$/, ''),
      type: 'image',
      tags: ['本地上传'],
      file: filename,
      preview: filename,
      previewUrl: `/api/dsh-wallpaper/preview?p=${encodeURIComponent(full)}`,
      harness: {
        kind: 'image',
        mediaUrl: `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}`,
        posterUrl: `/api/dsh-wallpaper/media?id=${encodeURIComponent(id)}`,
        compatible: true,
        status: 'native-image',
        previewWidth: dimensions?.width,
        previewHeight: dimensions?.height,
        quality: shortSide !== undefined && shortSide < LOW_QUALITY_SHORT_SIDE ? 'low' : 'standard',
        fit: shortSide !== undefined && shortSide < LOW_QUALITY_SHORT_SIDE ? 'ambient' : 'cover',
        ...(animation === undefined ? {} : { animation }),
      },
      nativeReady: NATIVE_IMAGE_EXTENSIONS.has(extname(filename).toLowerCase()),
      dir: this.uploadsDir,
      projectPath: undefined,
      sizeBytes: buffer.length,
    }
    return record
  }

  /** The wallpapers Wallpaper Engine is currently showing (config.json). */
  currentEngine() {
    if (this.installDir === undefined) return []
    const config = readJson(join(this.installDir, 'config.json'))
    if (config === undefined) return []
    const files = []
    const collect = (value) => {
      if (typeof value === 'object' && value !== null) {
        for (const [key, entry] of Object.entries(value)) {
          if (key === 'file' && typeof entry === 'string') files.push(entry)
          else collect(entry)
        }
      }
    }
    for (const sid of Object.values(config)) {
      const selected = sid?.general?.wallpaperconfig?.selectedwallpapers
      if (selected !== undefined) collect(selected)
      // recent history (optional surface)
      const recent = sid?.general?.wallpaperconfigrecent
      if (Array.isArray(recent)) {
        for (const item of recent) collect(item?.config?.selectedwallpapers)
      }
    }
    return [...new Set(files)]
  }

  /** Current native wallpaper via the registry (read-only). */
  async status() {
    await this.ensureDiscovered()
    let nativeCurrent
    try {
      const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true, timeout: 5000 })
      const match = /REG_SZ\s+([^\r\n]+)/.exec(stdout)
      if (match !== null) nativeCurrent = match[1].trim()
    } catch { /* not set / unavailable */ }
    let version
    if (this.installDir !== undefined) {
      const versionFile = readJson(join(this.installDir, 'version.json'))
      version = typeof versionFile?.version === 'string' ? versionFile.version : undefined
    }
    return {
      engine: {
        found: this.installDir !== undefined,
        installDir: this.installDir,
        workshopDir: this.workshopDir,
        version,
      },
      nativeCurrent,
      engineCurrent: this.currentEngine(),
      uploadsDir: this.uploadsDir,
    }
  }
}
