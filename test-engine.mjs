import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { WallpaperEngine, readGifAnimation } from './lib/engine.js'
import { makeRoutes } from './lib/routes.js'
import { wallpaperHarnessTool } from './lib/tools.js'

function fakeGif(width, height) {
  const header = Buffer.alloc(10)
  header.write('GIF89a', 0, 'ascii')
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  return header
}

function animatedGif(width, height, delays) {
  const chunks = [Buffer.from('GIF89a', 'ascii'), Buffer.alloc(7), Buffer.from([0, 0, 0, 255, 255, 255])]
  chunks[1].writeUInt16LE(width, 0)
  chunks[1].writeUInt16LE(height, 2)
  chunks[1][4] = 0x80
  for (const delay of delays) {
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00])
    gce.writeUInt16LE(delay, 4)
    chunks.push(gce)
  }
  chunks.push(Buffer.from([0x3b]))
  return Buffer.concat(chunks)
}

function fakePng(width, height) {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return header
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-test-'))
  const installDir = join(root, 'wallpaper_engine')
  const workshopDir = join(root, 'workshop')
  const uploadsDir = join(root, 'uploads')
  const stateFile = join(root, 'state', 'skin-state.json')
  mkdirSync(join(installDir, 'projects', 'myprojects'), { recursive: true })
  mkdirSync(workshopDir, { recursive: true })
  mkdirSync(uploadsDir, { recursive: true })

  const sceneDir = join(workshopDir, 'scene')
  mkdirSync(sceneDir)
  writeFileSync(join(sceneDir, 'project.json'), JSON.stringify({ title: '测试场景', type: 'Scene', file: 'scene.pkg', preview: 'preview.gif', tags: ['Scene'] }))
  writeFileSync(join(sceneDir, 'scene.pkg'), Buffer.from('scene-package'))
  writeFileSync(join(sceneDir, 'preview.gif'), animatedGif(192, 192, Array(50).fill(4)))

  const videoDir = join(workshopDir, 'video')
  mkdirSync(videoDir)
  writeFileSync(join(videoDir, 'project.json'), JSON.stringify({ title: '测试视频', type: 'Video', file: 'wallpaper.mp4', preview: 'preview.jpg', tags: ['Video'] }))
  writeFileSync(join(videoDir, 'wallpaper.mp4'), Buffer.alloc(2 * 1024 * 1024, 0x5a))
  writeFileSync(join(videoDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

  const engine = new WallpaperEngine({ installDir, workshopDir, uploadsDir, stateFile })
  return {
    root,
    installDir,
    workshopDir,
    uploadsDir,
    stateFile,
    sceneDir,
    videoDir,
    engine,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

async function startRouteServer(engine) {
  const { routes } = makeRoutes(engine)
  const byPath = new Map(routes.map(route => [route.path, route.handler]))
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = byPath.get(pathname)
    if (handler === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    Promise.resolve(handler(req, res)).catch(error => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String(error))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    server,
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function request(base, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base)
    const req = httpRequest(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.once('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

function json(response) {
  return JSON.parse(response.body.toString('utf8'))
}

test('scanner identifies video and Scene preview fallback without absolute media URLs', async () => {
  const fixture = createFixture()
  try {
    const all = await fixture.engine.list()
    const scene = all.find(item => item.id === 'workshop:scene')
    const video = all.find(item => item.id === 'workshop:video')
    assert.equal(all.length, 2)
    assert.equal(scene.harness.kind, 'image')
    assert.equal(scene.harness.status, 'preview-fallback')
    assert.equal(scene.harness.previewWidth, 192)
    assert.equal(scene.harness.previewHeight, 192)
    assert.equal(scene.harness.quality, 'low')
    assert.equal(scene.harness.fit, 'ambient')
    assert.deepEqual(scene.harness.animation, { kind: 'gif', frames: 50, durationMs: 2000, cutMs: 300, safeLoopMs: 1700 })
    assert.match(scene.harness.fallbackReason, /Scene/)
    assert.match(scene.harness.fallbackReason, /192×192/)
    assert.equal(video.harness.kind, 'video')
    assert.equal(video.harness.status, 'native-video')
    assert.equal(video.harness.mediaUrl, '/api/dsh-wallpaper/media?id=workshop%3Avideo')
    assert.equal(video.harness.mediaUrl.includes(fixture.root), false)

    const media = await fixture.engine.resolveHarnessMedia('workshop:video')
    const poster = await fixture.engine.resolveHarnessMedia('workshop:video', 'poster')
    assert.equal(media.kind, 'video')
    assert.equal(poster.kind, 'image')
    assert.equal(await fixture.engine.resolveHarnessMedia('../video'), undefined)
    assert.equal(fixture.engine.isAllowedPath(join(fixture.videoDir, 'preview.jpg')), true)
    assert.equal(fixture.engine.isAllowedPath(join(fixture.root, 'outside.jpg')), false)

    writeFileSync(join(fixture.sceneDir, 'background.png'), fakePng(1920, 1080))
    const rescanned = new WallpaperEngine({
      installDir: fixture.installDir,
      workshopDir: fixture.workshopDir,
      uploadsDir: fixture.uploadsDir,
      stateFile: fixture.stateFile,
    })
    const upgraded = (await rescanned.list()).find(item => item.id === 'workshop:scene')
    assert.equal(upgraded.preview, 'background.png')
    assert.equal(upgraded.harness.previewWidth, 1920)
    assert.equal(upgraded.harness.previewHeight, 1080)
    assert.equal(upgraded.harness.quality, 'standard')
    assert.equal(upgraded.harness.fit, 'cover')
  } finally {
    fixture.cleanup()
  }
})

test('GIF timing guard shortens every animated GIF by the configured safe tail', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-gif-'))
  try {
    const twoSeconds = join(root, 'two-seconds.gif')
    const short = join(root, 'short.gif')
    const staticGif = join(root, 'static.gif')
    writeFileSync(twoSeconds, animatedGif(20, 20, Array(50).fill(4)))
    writeFileSync(short, animatedGif(20, 20, [5, 5]))
    writeFileSync(staticGif, fakeGif(20, 20))
    assert.deepEqual(readGifAnimation(twoSeconds), { kind: 'gif', frames: 50, durationMs: 2000, cutMs: 300, safeLoopMs: 1700 })
    assert.deepEqual(readGifAnimation(short), { kind: 'gif', frames: 2, durationMs: 100, cutMs: 40, safeLoopMs: 60 })
    assert.equal(readGifAnimation(staticGif), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('realpath validation rejects a junction escape from a scanned project', async t => {
  const fixture = createFixture()
  try {
    const outside = join(fixture.root, 'outside')
    const escapedProject = join(fixture.workshopDir, 'escaped')
    mkdirSync(outside)
    mkdirSync(escapedProject)
    writeFileSync(join(outside, 'outside.mp4'), Buffer.from('outside'))
    try {
      symlinkSync(outside, join(escapedProject, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`junction creation unavailable: ${error.code ?? error.message}`)
      return
    }
    writeFileSync(join(escapedProject, 'project.json'), JSON.stringify({ title: '逃逸', type: 'Video', file: 'escape/outside.mp4' }))
    const record = (await fixture.engine.list()).find(item => item.id === 'workshop:escaped')
    assert.equal(record.harness.kind, 'video')
    assert.equal(await fixture.engine.resolveHarnessMedia(record.id), undefined)
  } finally {
    fixture.cleanup()
  }
})

test('skin state is atomic, restart-safe, revision-checked, and degrades after deletion', async () => {
  const fixture = createFixture()
  try {
    const applied = await fixture.engine.applyHarness('workshop:scene', 0.4, {
      panelOpacity: 0.65,
      inputOpacity: 0.75,
      blur: 12,
      brightness: 0.82,
      backgroundFit: 'contain',
      paletteMode: 'manual',
      accentColor: '#A1B2C3',
      secondaryAccentColor: '#33AA77',
    })
    assert.equal(applied.ok, true)
    assert.equal(applied.skin.revision, 1)
    assert.equal(applied.skin.enabled, true)
    assert.equal(applied.skin.scrim, 0.4)
    assert.equal(applied.skin.panelOpacity, 0.65)
    assert.equal(applied.skin.inputOpacity, 0.75)
    assert.equal(applied.skin.blur, 12)
    assert.equal(applied.skin.brightness, 0.82)
    assert.equal(applied.skin.backgroundFit, 'contain')
    assert.equal(applied.skin.schemaVersion, 2)
    assert.equal(applied.skin.preset, null)
    assert.equal(applied.skin.presets.length >= 1, true)
    assert.equal(applied.skin.paletteMode, 'manual')
    assert.equal(applied.skin.accentColor, '#a1b2c3')
    assert.equal(applied.skin.secondaryAccentColor, '#33aa77')
    assert.deepEqual(readdirSync(join(fixture.root, 'state')), ['skin-state.json'])

    const restarted = new WallpaperEngine({
      installDir: fixture.installDir,
      workshopDir: fixture.workshopDir,
      uploadsDir: fixture.uploadsDir,
      stateFile: fixture.stateFile,
    })
    const restored = await restarted.getSkin()
    assert.equal(restored.wallpaperId, 'workshop:scene')
    assert.equal(restored.panelOpacity, 0.65)
    assert.equal(restored.inputOpacity, 0.75)
    assert.equal(restored.blur, 12)
    assert.equal(restored.brightness, 0.82)
    assert.equal(restored.backgroundFit, 'contain')

    const [first, second] = await Promise.all([
      restarted.updateSkin({ action: 'apply', id: 'workshop:video', expectedRevision: 1 }),
      restarted.updateSkin({ action: 'clear', expectedRevision: 1 }),
    ])
    assert.equal(first.ok, true)
    assert.equal(second.ok, false)
    assert.equal(second.status, 409)
    assert.equal((await restarted.updateSkin({ action: 'apply', id: 'missing', scrim: 2 })).status, 400)
    assert.equal((await restarted.updateSkin({ action: 'apply', panelOpacity: 0.1 })).status, 400)
    assert.equal((await restarted.updateSkin({ action: 'apply', inputOpacity: 0.2 })).status, 400)
    assert.equal((await restarted.updateSkin({ action: 'apply', blur: 33 })).status, 400)
    assert.equal((await restarted.updateSkin({ action: 'apply', brightness: 2 })).status, 400)
    assert.equal((await restarted.updateSkin({ action: 'apply', backgroundFit: 'stretch' })).status, 400)
    assert.equal((await restarted.updateSkin({ action: 'apply', presetId: 'unknown-remote-theme' })).status, 400)
    const preset = await restarted.updateSkin({ action: 'apply', presetId: 'aurora' })
    assert.equal(preset.ok, true)
    assert.equal(preset.skin.preset.id, 'aurora')
    assert.equal(preset.skin.preset.footerText.includes('布局'), true)
    assert.equal((await restarted.updateSkin({ action: 'apply', paletteMode: 'manual', accentColor: 'red' })).status, 400)
    assert.equal((await restarted.updateSkin({ action: 'apply', secondaryAccentColor: '#12345g' })).status, 400)

    rmSync(fixture.videoDir, { recursive: true, force: true })
    const degraded = await restarted.getSkin()
    assert.equal(degraded.enabled, false)
    assert.equal(degraded.wallpaperId, null)
    assert.equal(degraded.revision, 4)
  } finally {
    fixture.cleanup()
  }
})

test('desktop apply contract remains separate and can be regressed without changing the desktop', async () => {
  const fixture = createFixture()
  try {
    let engineTarget
    fixture.engine.applyWithEngine = target => {
      engineTarget = target
      return { ok: true, mode: 'we', message: 'mocked' }
    }
    const we = await fixture.engine.apply('workshop:scene', 'we')
    assert.equal(we.ok, true)
    assert.match(engineTarget, /project\.json$/)

    let nativeTarget
    fixture.engine.applyNative = async target => {
      nativeTarget = target
      return { ok: true, mode: 'native', message: 'mocked' }
    }
    const native = await fixture.engine.apply('workshop:video', 'native')
    assert.equal(native.ok, true)
    assert.match(nativeTarget, /preview\.jpg$/)
  } finally {
    fixture.cleanup()
  }
})

test('wallpaper_harness tool exposes apply, random, and clear without using desktop apply', async () => {
  const calls = []
  const fake = {
    applyHarness: async (id, scrim) => { calls.push(['apply', id, scrim]); return successSkin(id, scrim) },
    randomHarness: async scrim => { calls.push(['random', scrim]); return successSkin('random-id', scrim) },
    clearHarness: async () => { calls.push(['clear']); return { ok: true, skin: { revision: 3, wallpaperId: null, enabled: false, scrim: 0.35, wallpaper: null } } },
    apply: async () => { throw new Error('desktop apply must not be called') },
  }
  function successSkin(id, scrim = 0.35) {
    return { ok: true, skin: { revision: 2, wallpaperId: id, enabled: true, scrim, wallpaper: { title: id, harness: { kind: 'image' } } } }
  }
  const tool = wallpaperHarnessTool(fake)
  assert.equal(tool.name, 'wallpaper_harness')
  assert.equal((await tool.execute({ action: 'apply', id: 'workshop:scene', scrim: 0.4 })).ok, true)
  assert.equal((await tool.execute({ action: 'random' })).action, 'random')
  assert.equal((await tool.execute({ action: 'clear' })).enabled, false)
  assert.deepEqual(calls, [
    ['apply', 'workshop:scene', 0.4],
    ['random', undefined],
    ['clear'],
  ])
})

test('media and skin routes support HEAD, streaming Range, 416, body limits, and client abort', async () => {
  const fixture = createFixture()
  const host = await startRouteServer(fixture.engine)
  try {
    const full = await request(host.base, '/api/dsh-wallpaper/media?id=workshop%3Avideo')
    assert.equal(full.status, 200)
    assert.equal(full.headers['content-type'], 'video/mp4')
    assert.equal(full.body.length, 2 * 1024 * 1024)
    assert.equal(full.headers['accept-ranges'], 'bytes')

    const head = await request(host.base, '/api/dsh-wallpaper/media?id=workshop%3Avideo', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.body.length, 0)
    assert.equal(Number(head.headers['content-length']), 2 * 1024 * 1024)

    const partial = await request(host.base, '/api/dsh-wallpaper/media?id=workshop%3Avideo', { headers: { range: 'bytes=0-1023' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.body.length, 1024)
    assert.equal(partial.headers['content-range'], `bytes 0-1023/${2 * 1024 * 1024}`)

    const invalidRange = await request(host.base, '/api/dsh-wallpaper/media?id=workshop%3Avideo', { headers: { range: 'bytes=99999999-' } })
    assert.equal(invalidRange.status, 416)
    assert.equal(invalidRange.headers['content-range'], `bytes */${2 * 1024 * 1024}`)
    assert.equal((await request(host.base, '/api/dsh-wallpaper/media?id=..%2Fvideo')).status, 404)

    const poster = await request(host.base, '/api/dsh-wallpaper/media?id=workshop%3Avideo&variant=poster')
    assert.equal(poster.status, 200)
    assert.equal(poster.headers['content-type'], 'image/jpeg')

    const initialSkin = json(await request(host.base, '/api/dsh-wallpaper/skin'))
    assert.equal(initialSkin.skin.exists, false)
    const applied = json(await request(host.base, '/api/dsh-wallpaper/skin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'apply', id: 'workshop:scene', scrim: 0.35, panelOpacity: 0.6, inputOpacity: 0.8, blur: 10, paletteMode: 'manual', accentColor: '#336699', secondaryAccentColor: '#55aa77' }),
    }))
    assert.equal(applied.skin.enabled, true)
    assert.equal(applied.skin.wallpaper.harness.kind, 'image')
    assert.equal(applied.skin.panelOpacity, 0.6)
    assert.equal(applied.skin.inputOpacity, 0.8)
    assert.equal(applied.skin.blur, 10)
    assert.equal(applied.skin.accentColor, '#336699')
    assert.equal(applied.skin.secondaryAccentColor, '#55aa77')
    assert.equal(applied.skin.schemaVersion, 2)

    const bridge = json(await request(host.base, '/api/dsh-wallpaper/scene-bridge'))
    assert.equal(bridge.bridge.available, false)
    const bridgeEnable = await request(host.base, '/api/dsh-wallpaper/scene-bridge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'enable' }),
    })
    assert.equal(bridgeEnable.status, 409)
    const bridgeExtractMissingId = await request(host.base, '/api/dsh-wallpaper/scene-bridge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'extract' }),
    })
    assert.equal(bridgeExtractMissingId.status, 400)

    const invalidAppearance = await request(host.base, '/api/dsh-wallpaper/skin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'apply', panelOpacity: 1, inputOpacity: 2, blur: 99, accentColor: 'blue', secondaryAccentColor: 'green' }),
    })
    assert.equal(invalidAppearance.status, 400)

    const tooLarge = await request(host.base, '/api/dsh-wallpaper/skin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
    })
    assert.equal(tooLarge.status, 413)

    await new Promise((resolve, reject) => {
      const req = httpRequest(new URL('/api/dsh-wallpaper/media?id=workshop%3Avideo', host.base), res => {
        res.once('data', () => {
          res.destroy()
          resolve()
        })
      })
      req.once('error', error => {
        if (error.code === 'ECONNRESET') resolve()
        else reject(error)
      })
      req.end()
    })
    const afterAbort = await request(host.base, '/api/dsh-wallpaper/media?id=workshop%3Avideo', { headers: { range: 'bytes=10-19' } })
    assert.equal(afterAbort.status, 206)
    assert.equal(afterAbort.body.length, 10)
  } finally {
    await host.close()
    fixture.cleanup()
  }
})

test('upload rejects unsupported image extensions before writing and accepts supported images', async () => {
  const fixture = createFixture()
  const host = await startRouteServer(fixture.engine)
  try {
    const unsupported = await request(host.base, '/api/dsh-wallpaper/upload?name=sample.avif', {
      method: 'POST',
      body: Buffer.from('not-an-avif'),
    })
    assert.equal(unsupported.status, 415)
    assert.match(json(unsupported).error, /不支持的图片格式/)
    assert.deepEqual(readdirSync(fixture.uploadsDir), [])

    const supported = await request(host.base, '/api/dsh-wallpaper/upload?name=sample.gif', {
      method: 'POST',
      body: animatedGif(20, 20, Array(10).fill(4)),
    })
    assert.equal(supported.status, 201)
    const saved = json(supported).wallpaper
    assert.match(saved.id, /^local-file:/)
    assert.equal(saved.harness.previewWidth, 20)
    assert.equal(saved.harness.previewHeight, 20)
    assert.equal(saved.harness.fit, 'ambient')
    assert.deepEqual(saved.harness.animation, { kind: 'gif', frames: 10, durationMs: 400, cutMs: 120, safeLoopMs: 280 })
    assert.equal((await fixture.engine.list()).some(item => item.id === saved.id), true)
  } finally {
    await host.close()
    fixture.cleanup()
  }
})

test('CLI installs and uninstalls against an isolated DSH profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-cli-'))
  try {
    const profile = join(root, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-wallpaper-skin', 'dsh-wallpaper'] } } }))
    const cli = fileURLToPath(new URL('./bin/dsh-wallpaper.mjs', import.meta.url))
    const run = args => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, DSH_HOME: root } }))
    assert.equal(run(['doctor']).profileFound, true)
    const installed = run(['install'])
    assert.equal(installed.registered, true)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies['backdrop-bridge-dsh'], 'file:node_modules/backdrop-bridge-dsh')
    assert.equal(manifest.dsh.profile.bundles.includes('backdrop-bridge-dsh'), true)
    assert.equal(manifest.dsh.profile.bundles.includes('dsh-wallpaper'), false)
    assert.equal(readFileSync(join(profile, 'node_modules', 'backdrop-bridge-dsh', 'package.json'), 'utf8').includes('backdrop-bridge-dsh'), true)
    const removed = run(['uninstall'])
    assert.equal(removed.registered, false)
    assert.equal(removed.packageFound, true)
    const purged = run(['uninstall', '--purge'])
    assert.equal(purged.packageFound, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('client skin uses wallpaper-derived surfaces and generation-safe image replacement', () => {
  const client = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8')
  assert.match(client, /html body\[data-dsh-wallpaper-skin\]/)
  assert.match(client, /--wp-border-strong/)
  assert.match(client, /--wp-fg-primary/)
  assert.match(client, /--dsw-alias-label-primary:var\(--wp-fg-primary/)
  assert.match(client, /--dsw-alias-label-secondary:var\(--wp-fg-secondary/)
  assert.match(client, /--dsw-alias-brand-primary:var\(--wp-accent/)
  assert.match(client, /面板不透明度/)
  assert.match(client, /输入区不透明度/)
  assert.match(client, /min: '0\.15', max: '0\.9', step: '0\.01'/)
  assert.match(client, /min: '0\.3', max: '1', step: '0\.01'/)
  assert.match(client, /毛玻璃强度/)
  assert.match(client, /自动取色/)
  assert.match(client, /第二强调色/)
  assert.match(client, /--wp-send-color/)
  assert.match(client, /ensureContrast\(accent, surface, 4\.5/)
  assert.match(client, /ensureContrast\(foregroundPrimary, surface, 4\.5/)
  assert.match(client, /var vibrant/)
  assert.match(client, /ensureContrast\(secondary, \[255, 255, 255\], 4\.5/)
  assert.match(client, /markAdaptiveSurfaces/)
  assert.match(client, /data-dsh-wallpaper-surface/)
  assert.match(client, /data-wp-low-quality/)
  assert.match(client, /wpAmbient/)
  assert.match(client, /z-index: -1/)
  assert.match(client, /isolation: isolate/)
  assert.doesNotMatch(client, /conversation'\] > :not\(\[data-dsh-wallpaper-view\]\) \{ display: none/)
  assert.match(client, /data-dsh-ssh-entry/)
  assert.match(client, /var preferredAnchor = entryAnchor\(\)/)
  assert.match(client, /preferredAnchor !== undefined && preferredAnchor !== anchor/)
  assert.match(client, /entry\.previousElementSibling !== anchor/)
  assert.match(client, /position: fixed; inset: 12px 12px 12px auto/)
  assert.match(client, /壁纸亮度/)
  assert.match(client, /壁纸适配/)
  assert.match(client, /安全主题预设/)
  assert.match(client, /presetId/)
  assert.match(client, /sampleWallpaperPalette/)
  assert.match(client, /data-wp-still/)
  assert.match(client, /captureGifStill/)
  assert.match(client, /scheduleGifLoop/)
  assert.match(client, /captureLeadMs/)
  assert.match(client, /Freeze the \*current\* near-tail frame/)
  assert.match(client, /GIF 安全帧/)
  assert.match(client, /animation\.safeLoopMs/)
  assert.match(client, /resolveBackdropFit/)
  assert.match(client, /applyBackdropFit/)
  assert.match(client, /data-wp-fit="ambient"/)
  assert.match(client, /sourceRatio \/ viewportRatio/)
  assert.match(client, /window\.addEventListener\('resize'/)
  assert.match(client, /background: var\(--wp-bg-layer-1\) !important/)
  assert.match(client, /saturate\(1\.20\) contrast\(1\.03\)/)
  assert.match(client, /function syncLibrary\(\)/)
  assert.match(client, /window\.setInterval\(syncLibrary, 6000\)/)
  assert.match(client, /fetch\(API\.list, \{ cache: 'no-store' \}\)/)
  assert.match(client, /已同步 Wallpaper Engine 素材库/)
  assert.match(client, /clearGifLoop\(true\)/)
  assert.match(client, /clearGifLoop\(\)\n\s*skinRuntime\.mediaGeneration \+= 1\n\s*if \(typeof harness\.posterUrl/)
  assert.match(client, /setTimeout\(function \(\) \{\n          surfaceTimer = undefined/)
  assert.match(client, /layer\.replaceChild\(next, image\)/)
  assert.match(client, /generation !== skinRuntime\.mediaGeneration/)
  assert.doesNotMatch(client, /\[class\*=/)
  assert.doesNotMatch(readme, /35100|link:C:\/Users/)
})
