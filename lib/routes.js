/**
 * The /api/dsh-wallpaper route family: engine status, wallpaper listing,
 * preview image serving, apply (WE / native / random), and image upload.
 * Every route carries the same loopback-only trust fence the dsh-ssh routes
 * use — these endpoints change the user's desktop, so LAN-exposed dsh web
 * deployments must not serve them.
 */

import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'

import { UNSUPPORTED_IMAGE_FORMAT } from './engine.js'

/** Cap on uploaded image bodies (a 4K PNG is a few MB; 64 MB is generous). */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024

/** Cap on JSON request bodies (apply payloads are tiny). */
const MAX_JSON_BODY_BYTES = 64 * 1024
const BODY_TOO_LARGE = Symbol('body-too-large')

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}
const PREVIEW_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])

/** Mirror of the pairing routes' loopback fence. */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_JSON_BODY_BYTES) return BODY_TOO_LARGE
    chunks.push(chunk)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Parse one RFC 7233 byte range. Multiple ranges are intentionally rejected. */
function parseRange(value, size) {
  if (!Number.isSafeInteger(size) || size <= 0) return undefined
  if (typeof value !== 'string' || !value.startsWith('bytes=') || value.includes(',')) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (match === null || (match[1] === '' && match[2] === '')) return undefined
  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return undefined
    if (start >= size) return undefined
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

/** Read the raw request body (undefined when too large). */
async function readRawBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_UPLOAD_BYTES) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Build the /api/dsh-wallpaper route family. */
export function makeRoutes(engine) {
  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  const guardAny = (req, res, methods) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (!methods.includes(req.method)) {
      res.setHeader('allow', methods.join(', '))
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  const routes = [
    // ---------------------------------------------------------- status
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/status',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, { status: await engine.status() })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ------------------------------------------------------------ list
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/list',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const query = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
          const type = url.searchParams.get('type') ?? ''
          const tag = url.searchParams.get('tag') ?? ''
          const library = await engine.librarySnapshot()
          let wallpapers = await engine.list()
          if (type !== '') wallpapers = wallpapers.filter(item => item.type === type)
          if (tag !== '') wallpapers = wallpapers.filter(item => item.tags.some(t => t.toLowerCase() === tag.toLowerCase()))
          if (query !== '') {
            wallpapers = wallpapers.filter(item =>
              item.title.toLowerCase().includes(query)
              || item.id.toLowerCase().includes(query)
              || item.tags.some(t => t.toLowerCase().includes(query)))
          }
          writeJson(res, 200, { wallpapers, total: wallpapers.length, revision: library.revision, watching: library.watching })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ----------------------------------------------------- library watch
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/library-watch',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const revision = Number(url.searchParams.get('revision'))
        const timeout = Number(url.searchParams.get('timeout'))
        const controller = new AbortController()
        const abort = () => controller.abort()
        req.once('aborted', abort)
        res.once('close', () => { if (!res.writableEnded) abort() })
        try {
          const update = await engine.waitForLibraryChange(revision, timeout, controller.signal)
          if (!controller.signal.aborted) writeJson(res, 200, update)
        } catch (error) {
          if (!controller.signal.aborted) writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        } finally {
          req.removeListener('aborted', abort)
        }
      },
    },
    // --------------------------------------------------------- preview
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/preview',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.searchParams.get('p') ?? ''
        if (path === '' || !engine.isAllowedPath(path)) {
          writeJson(res, 403, { error: 'forbidden: path not allowed' })
          return
        }
        const extension = extname(path).toLowerCase()
        if (!PREVIEW_EXTENSIONS.has(extension)) {
          writeJson(res, 403, { error: 'forbidden: preview must be an image' })
          return
        }
        let size
        try {
          size = statSync(path).size
        } catch {
          writeJson(res, 404, { error: 'file not found' })
          return
        }
        const mime = MIME[extension] ?? 'application/octet-stream'
        res.writeHead(200, {
          'content-type': mime,
          'content-length': String(size),
          'cache-control': 'public, max-age=86400',
          'referrer-policy': 'no-referrer',
        })
        const stream = createReadStream(path)
        req.once('aborted', () => stream.destroy())
        res.once('close', () => { if (!res.writableEnded) stream.destroy() })
        stream.once('error', () => { if (!res.destroyed) res.destroy() })
        stream.pipe(res)
      },
    },
    // ----------------------------------------------------------- media
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/media',
      handler: async (req, res) => {
        if (!guardAny(req, res, ['GET', 'HEAD'])) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        const variant = url.searchParams.get('variant') === 'poster' ? 'poster' : 'media'
        if (id === '' || id.length > 512) {
          writeJson(res, 400, { error: 'valid wallpaper id is required' })
          return
        }
        let media
        try { media = await engine.resolveHarnessMedia(id, variant) } catch { /* scan failed below */ }
        if (media === undefined) {
          writeJson(res, 404, { error: 'media not found' })
          return
        }
        let size
        try { size = statSync(media.path).size } catch {
          writeJson(res, 404, { error: 'media not found' })
          return
        }
        const mime = MIME[extname(media.path).toLowerCase()] ?? 'application/octet-stream'
        const rangeHeader = req.headers.range
        const range = rangeHeader === undefined ? undefined : parseRange(rangeHeader, size)
        if (rangeHeader !== undefined && range === undefined) {
          res.writeHead(416, {
            'content-range': `bytes */${size}`,
            'accept-ranges': 'bytes',
            'cache-control': 'private, max-age=3600',
            'referrer-policy': 'no-referrer',
          })
          res.end()
          return
        }
        const start = range?.start ?? 0
        const end = range?.end ?? Math.max(size - 1, 0)
        const status = range === undefined ? 200 : 206
        const headers = {
          'content-type': mime,
          'content-length': String(size === 0 ? 0 : end - start + 1),
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=3600',
          'referrer-policy': 'no-referrer',
        }
        if (range !== undefined) headers['content-range'] = `bytes ${start}-${end}/${size}`
        res.writeHead(status, headers)
        if (req.method === 'HEAD' || size === 0) {
          res.end()
          return
        }
        const stream = createReadStream(media.path, { start, end })
        const stop = () => { if (!stream.destroyed) stream.destroy() }
        req.once('aborted', stop)
        res.once('close', () => { if (!res.writableEnded) stop() })
        stream.once('error', () => { if (!res.destroyed) res.destroy() })
        stream.pipe(res)
      },
    },
    // ------------------------------------------------------------ skin
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/skin',
      handler: async (req, res) => {
        if (!guardAny(req, res, ['GET', 'POST'])) return
        try {
          if (req.method === 'GET') {
            writeJson(res, 200, { skin: await engine.getSkin() })
            return
          }
          const body = await readJsonBody(req)
          if (body === BODY_TOO_LARGE) {
            writeJson(res, 413, { error: 'JSON body too large' })
            return
          }
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const action = typeof body.action === 'string' ? body.action : 'apply'
          if (!['apply', 'random', 'clear'].includes(action)) {
            writeJson(res, 400, { error: 'action must be apply, random, or clear' })
            return
          }
          if (body.id !== undefined && (typeof body.id !== 'string' || body.id === '' || body.id.length > 512)) {
            writeJson(res, 400, { error: 'id must be a non-empty wallpaper id' })
            return
          }
          if (body.expectedRevision !== undefined && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)) {
            writeJson(res, 400, { error: 'expectedRevision must be a non-negative integer' })
            return
          }
          const result = await engine.updateSkin({
            action,
            id: body.id,
            enabled: body.enabled,
            scrim: body.scrim,
            panelOpacity: body.panelOpacity,
            inputOpacity: body.inputOpacity,
            blur: body.blur,
            brightness: body.brightness,
            backgroundFit: body.backgroundFit,
            motionMode: body.motionMode,
            presetId: body.presetId,
            paletteMode: body.paletteMode,
            accentColor: body.accentColor,
            secondaryAccentColor: body.secondaryAccentColor,
            expectedRevision: body.expectedRevision,
          })
          if (!result.ok) {
            writeJson(res, result.status ?? 400, { error: result.error, skin: result.skin })
            return
          }
          writeJson(res, 200, { skin: result.skin })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ------------------------------------------------------ scene bridge
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/scene-bridge',
      handler: async (req, res) => {
        if (!guardAny(req, res, ['GET', 'POST'])) return
        try {
          if (req.method === 'GET') {
            writeJson(res, 200, { bridge: engine.sceneBridgeStatus() })
            return
          }
          const body = await readJsonBody(req)
          if (body === BODY_TOO_LARGE) {
            writeJson(res, 413, { error: 'JSON body too large' })
            return
          }
          if (body === undefined || typeof body.action !== 'string') {
            writeJson(res, 400, { error: 'scene bridge action is required' })
            return
          }
          if (body.id !== undefined && (typeof body.id !== 'string' || body.id === '' || body.id.length > 512)) {
            writeJson(res, 400, { error: 'id must be a non-empty scanned wallpaper id' })
            return
          }
          const result = await engine.updateSceneBridge({ action: body.action, id: body.id })
          if (!result.ok) {
            writeJson(res, result.status ?? 400, { error: result.error, bridge: result.bridge })
            return
          }
          writeJson(res, 200, { bridge: result.bridge, skin: result.skin })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ----------------------------------------------------------- apply
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/apply',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === BODY_TOO_LARGE) {
          writeJson(res, 413, { error: 'JSON body too large' })
          return
        }
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const id = typeof body?.id === 'string' ? body.id : undefined
        const imagePath = typeof body?.imagePath === 'string' && body.imagePath !== '' ? body.imagePath : undefined
        const mode = typeof body?.mode === 'string' && body.mode !== '' ? body.mode : (imagePath !== undefined ? 'native' : 'we')
        if (mode === 'random') {
          writeJson(res, 200, { result: await engine.apply(undefined, 'random') })
          return
        }
        if (imagePath !== undefined && mode === 'native') {
          writeJson(res, 200, { result: await engine.applyNative(imagePath) })
          return
        }
        if (id === undefined) {
          writeJson(res, 400, { error: 'id (or imagePath with mode=native) is required' })
          return
        }
        try {
          writeJson(res, 200, { result: await engine.apply(id, mode) })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---------------------------------------------------------- upload
    {
      kind: 'exact',
      path: '/api/dsh-wallpaper/upload',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const name = url.searchParams.get('name') ?? 'wallpaper.png'
        const buffer = await readRawBody(req)
        if (buffer === undefined) {
          writeJson(res, 413, { error: 'upload body too large' })
          return
        }
        try {
          const record = engine.saveUpload(name, buffer)
          writeJson(res, 201, { wallpaper: record })
        } catch (error) {
          const status = error?.code === UNSUPPORTED_IMAGE_FORMAT ? 415 : 500
          writeJson(res, status, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]

  return { routes }
}
