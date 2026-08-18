/**
 * dsh-wallpaper — browser half. Runs inside the dsh web GUI as a
 * `window.__ModuleLoader__` bundle (the format the web shell expects), but is
 * hand-written plain JS with a pure-DOM panel — no React, no build step.
 *
 * Surfaces:
 *  - a sidebar entry row 「壁纸」 that toggles the panel;
 *  - a wallpaper gallery panel in the center column: search / type filter,
 *    card grid with Harness / Wallpaper Engine / Windows actions;
 *  - a fixed, click-through image/video backdrop synchronized through the
 *    host skin-state file, revision polling, focus refresh, and BroadcastChannel.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — an
 * external plugin must not take the GUI down.
 */
window.__ModuleLoader__.load({
  id: 'backdrop-bridge-dsh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ------------------------------------------------------------------ css
    var CSS = [
      '/* --- safe page backdrop: always paints below every Harness control --- */',
      'html { background: #0b1020; }',
      'html body[data-dsh-wallpaper-skin] { isolation: isolate; min-height: 100vh; }',
      '[data-dsh-wallpaper-backdrop] { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; background: #0b1020; }',
      '[data-dsh-wallpaper-backdrop] > img, [data-dsh-wallpaper-backdrop] > video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; pointer-events: none; filter: brightness(var(--wp-brightness,1)); }',
      '[data-dsh-wallpaper-backdrop][data-wp-fit="contain"] > img:not([data-wp-ambient]), [data-dsh-wallpaper-backdrop][data-wp-fit="contain"] > video, [data-dsh-wallpaper-backdrop][data-wp-fit="ambient"] > img:not([data-wp-ambient]), [data-dsh-wallpaper-backdrop][data-wp-fit="ambient"] > video { object-fit: contain; }',
      '[data-dsh-wallpaper-backdrop] > img[data-wp-ambient] { object-fit: cover; filter: blur(30px) saturate(1.12) brightness(var(--wp-brightness,1)); transform: scale(1.12); opacity: .92; }',
      '[data-dsh-wallpaper-backdrop] > img[data-wp-still] { z-index: 1; opacity: 0; }',
      '[data-dsh-wallpaper-backdrop] > img[data-wp-primary], [data-dsh-wallpaper-backdrop] > video { z-index: 2; transition: opacity 120ms ease; }',
      '[data-dsh-wallpaper-backdrop][data-wp-low-quality] > img:not([data-wp-ambient]) { filter: drop-shadow(0 0 26px rgba(0,0,0,.24)); }',
      '[data-dsh-wallpaper-backdrop] > [data-wp-hidden] { display: none; }',
      '.wp-backdropScrim { position: absolute; inset: 0; background: rgba(8, 12, 26, var(--wp-harness-scrim, .35)); }',
      'html body[data-dsh-wallpaper-skin] { --dsw-alias-bg-base:var(--wp-bg-base,rgba(245,248,252,.18)) !important; --dsw-alias-bg-layer-1:var(--wp-bg-layer-1,rgba(245,248,252,.32)) !important; --dsw-alias-bg-layer-2:var(--wp-bg-layer-2,rgba(245,248,252,.46)) !important; --dsw-alias-bg-layer-3:var(--wp-bg-layer-3,rgba(245,248,252,.62)) !important; --dsw-specific-sidebar-fill:var(--wp-sidebar,rgba(245,248,252,.50)) !important; --dsw-specific-input-major:var(--wp-input,rgba(250,252,255,.82)) !important; --dsw-alias-bg-overlay:var(--wp-overlay,rgba(248,251,255,.95)) !important; --dsw-alias-markdown-code-block:var(--wp-code,rgba(244,248,252,.90)) !important; --dsw-alias-markdown-inline-code:var(--wp-code-inline,rgba(238,244,250,.84)) !important; --dsw-alias-border-l1:var(--wp-border-soft,rgba(70,100,135,.30)) !important; --dsw-alias-border-l2:var(--wp-border-strong,rgba(55,90,130,.50)) !important; --dsw-alias-label-primary:var(--wp-fg-primary,#0a1e4a) !important; --dsw-alias-label-secondary:var(--wp-fg-secondary,#16315f) !important; --dsw-alias-label-tertiary:var(--wp-fg-tertiary,#406fab) !important; --dsw-alias-label-caption:var(--wp-fg-tertiary,#406fab) !important; --dsw-alias-label-primary-bluish:var(--wp-accent,#0e3074) !important; --dsw-alias-label-primary-dimmed:var(--wp-fg-secondary,#294b82) !important; --dsw-alias-label-dimmed:var(--wp-fg-dimmed,#a2b4cf) !important; --dsw-alias-brand-primary:var(--wp-accent,#4f8cff) !important; --dsw-alias-brand-text:var(--wp-fg-primary,#122b54) !important; --dsw-alias-state-business-primary:var(--wp-accent,#4f8cff) !important; --dsw-alias-button-primary-fill:var(--wp-accent,#4f8cff) !important; --dsw-alias-button-primary-hover:var(--wp-accent-hover,#3e75d0) !important; --dsw-alias-button-contrast-fill:var(--wp-accent,#4f8cff) !important; --dsw-alias-button-info-fill:var(--wp-accent-secondary,var(--wp-accent,#4f8cff)) !important; --dsw-alias-button-info-hover:var(--wp-accent-secondary-hover,var(--wp-accent-hover,#3e75d0)) !important; --dsw-specific-sidebar-nav-item-active:var(--wp-accent-wash,rgba(79,140,255,.22)) !important; --dsw-specific-sidebar-nav-item-active-accent:var(--wp-accent-wash-strong,rgba(79,140,255,.32)) !important; --dsw-specific-sidebar-nav-item-hover:var(--wp-accent-wash-soft,rgba(79,140,255,.14)) !important; --dsw-alias-interactive-bg-hover:var(--wp-accent-wash-soft,rgba(79,140,255,.14)) !important; }',
      'html body[data-dsh-wallpaper-skin] [data-pane="sidebar"] { background: var(--wp-sidebar) !important; }',
      'html body[data-dsh-wallpaper-skin] [data-pane="conversation"], html body[data-dsh-wallpaper-skin] [data-pane="details"], html body[data-dsh-wallpaper-skin] [data-shell-overlay] > * { background: var(--wp-bg-layer-1) !important; }',
      'html body[data-dsh-wallpaper-skin] [data-composer-seat] > * { background: var(--wp-input) !important; }',
      'html body[data-dsh-wallpaper-skin] [data-pane="sidebar"], html body[data-dsh-wallpaper-skin] [data-pane="conversation"], html body[data-dsh-wallpaper-skin] [data-pane="details"], html body[data-dsh-wallpaper-skin] [data-composer-seat] > *, html body[data-dsh-wallpaper-skin] [data-shell-overlay] > *, html body[data-dsh-wallpaper-skin] [data-dsh-wallpaper-view] { backdrop-filter: blur(var(--wp-blur,8px)) saturate(1.20) contrast(1.03); -webkit-backdrop-filter: blur(var(--wp-blur,8px)) saturate(1.20) contrast(1.03); box-shadow: inset 0 1px 0 rgba(255,255,255,.18); }',
      'html body[data-dsh-wallpaper-skin] [data-dsh-wallpaper-surface] { backdrop-filter: blur(var(--wp-blur,8px)) saturate(1.20) contrast(1.03) !important; -webkit-backdrop-filter: blur(var(--wp-blur,8px)) saturate(1.20) contrast(1.03) !important; }',
      'html body[data-dsh-wallpaper-skin] [data-pane="conversation"] :is(h1,h2,h3), html body[data-dsh-wallpaper-skin] [data-dsh-wallpaper-view] .wp-title { color: var(--wp-title-color,var(--dsw-alias-label-primary)); }',
      'html body[data-dsh-wallpaper-skin] button:is([aria-label="发送消息"],[aria-label="Send message"]):not(:disabled) { background: var(--wp-send-color,var(--dsw-alias-button-info-fill)) !important; }',
      'html body[data-dsh-wallpaper-skin] [role="dialog"], html body[data-dsh-wallpaper-skin] [role="menu"], html body[data-dsh-wallpaper-skin] .cm-editor, html body[data-dsh-wallpaper-skin] pre { background-color: var(--dsw-alias-bg-overlay) !important; }',
      '[data-dsh-wallpaper-view] { position: fixed; inset: 12px 12px 12px auto; display: block; z-index: 2147483000; width: min(760px, calc(100vw - 24px)); min-width: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; box-shadow: 0 18px 56px rgba(0,0,0,.42); }',
      '[data-dsh-wallpaper-view][hidden] { display: none !important; }',
      '/* --- sidebar entry --- */',
      '[data-dsh-wallpaper-entry] { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 12px; background: transparent; border: none; border-radius: 8px; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 13px; white-space: nowrap; }',
      '[data-dsh-wallpaper-entry]:hover { background: var(--dsw-specific-sidebar-nav-item-hover); color: var(--dsw-alias-label-primary); }',
      '[data-dsh-wallpaper-entry][data-active] { background: var(--dsw-specific-sidebar-nav-item-active); color: var(--dsw-alias-label-primary); font-weight: 600; }',
      '[data-dsh-wallpaper-entry]:focus-visible, .wp-btn:focus-visible, .wp-search:focus-visible, .wp-select:focus-visible, .wp-path:focus-visible, .wp-scrim input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
      '[data-dsh-frame][data-sidebar-collapsed] [data-dsh-wallpaper-entry] { justify-content: center; padding: 0; width: 100%; }',
      '[data-dsh-frame][data-sidebar-collapsed] [data-dsh-wallpaper-entry] .wp-entryLabel { display: none; }',
      '.wp-entryIcon { display: inline-flex; align-items: center; justify-content: center; flex: none; }',
      '.wp-entryLabel { overflow: hidden; text-overflow: ellipsis; }',
      '/* --- panel frame --- */',
      '.wp-panel { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 14px 16px 16px; gap: 10px; overflow-x: hidden; background: var(--dsw-alias-bg-overlay); backdrop-filter: blur(var(--wp-blur,8px)) saturate(1.08); -webkit-backdrop-filter: blur(var(--wp-blur,8px)) saturate(1.08); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }',
      '.wp-header { display: flex; align-items: center; gap: 10px; flex: none; }',
      '.wp-title { margin: 0; flex: 1; font-size: 16px; font-weight: 700; white-space: nowrap; }',
      '.wp-toolbar { display: flex; align-items: center; gap: 8px; flex: none; flex-wrap: wrap; }',
      '.wp-search { flex: 0 1 220px; min-width: 120px; padding: 6px 10px; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-input-major); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }',
      '.wp-search::placeholder { color: var(--dsw-alias-label-tertiary); }',
      '.wp-select { padding: 6px 8px; font-size: 12.5px; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-input-major); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }',
      '.wp-btn { padding: 5px 12px; font-size: 12px; color: var(--dsw-alias-label-primary); background: transparent; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; cursor: pointer; white-space: nowrap; }',
      '.wp-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }',
      '.wp-btn:disabled { opacity: 0.5; cursor: default; }',
      '.wp-btn-primary { color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-info-fill); border: none; font-weight: 600; }',
      '.wp-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover); }',
      '.wp-spacer { flex: 1; }',
      '.wp-banner { padding: 8px 12px; font-size: 12.5px; line-height: 1.5; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; flex: none; }',
      ".wp-banner[data-kind='ok'] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }",
      ".wp-banner[data-kind='error'] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }",
      ".wp-banner[data-kind='info'] { color: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }",
      '.wp-grid { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); grid-auto-rows: max-content; gap: 12px; align-content: start; padding: 2px 2px 12px; overscroll-behavior: contain; }',
      '.wp-card { display: flex; flex-direction: column; min-width: 0; min-height: 250px; align-self: start; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); }',
      '.wp-card:hover { border-color: var(--dsw-alias-border-l2); }',
      '.wp-card[data-current] { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary); }',
      '.wp-thumb { position: relative; aspect-ratio: 16 / 9; background: var(--dsw-alias-bg-layer-1); }',
      '.wp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.wp-thumb[data-failed]::after { content: attr(data-fallback); position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); }',
      '.wp-body { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px; }',
      '.wp-cardTitle { font-size: 12.5px; font-weight: 600; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }',
      '.wp-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
      '.wp-tag { padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; line-height: 1.6; }',
      '.wp-tag[data-quality="low"] { color: var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-error-primary)); border-color: currentColor; }',
      '.wp-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }',
      '.wp-actions .wp-btn { min-width: 0; min-height: 32px; padding: 5px 8px; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; }',
      '.wp-actions .wp-harness { grid-column: 1 / -1; }',
      '.wp-empty, .wp-loading { padding: 28px 12px; text-align: center; font-size: 12.5px; color: var(--dsw-alias-label-tertiary); grid-column: 1 / -1; }',
      '.wp-presetNote { margin: 0; flex: none; font-size: 11.5px; line-height: 1.45; color: var(--dsw-alias-label-tertiary); }',
      '.wp-local { display: flex; gap: 8px; align-items: center; flex: none; flex-wrap: wrap; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; }',
      '.wp-local .wp-path { flex: 0 1 320px; min-width: 140px; padding: 5px 9px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-input-major); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }',
      '.wp-scrim { display: flex; align-items: center; gap: 8px; min-width: 0; flex: none; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      '.wp-scrim input[type=range] { width: min(180px, 35vw); accent-color: var(--dsw-alias-state-business-primary); }',
      '.wp-appearance { flex: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }',
      '.wp-appearance > summary { cursor: pointer; padding: 8px 10px; font-size: 12.5px; font-weight: 600; }',
      '.wp-settingsGrid { display: grid; grid-template-columns: repeat(auto-fit,minmax(210px,1fr)); gap: 8px 14px; padding: 0 10px 10px; }',
      '.wp-setting { display: grid; grid-template-columns: minmax(88px,auto) 1fr auto; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      '.wp-setting input[type=range] { min-width: 80px; width: 100%; accent-color: var(--dsw-alias-state-business-primary); }',
      '.wp-setting input[type=color] { width: 42px; height: 26px; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-specific-input-major); }',
      '.wp-setting select { min-width: 90px; }',
      '.wp-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--dsw-alias-state-business-primary); border-top-color: transparent; border-radius: 50%; animation: wpSpin 800ms linear infinite; vertical-align: -1px; }',
      '@keyframes wpSpin { to { transform: rotate(360deg); } }',
      '@media (max-width: 760px) { [data-dsh-wallpaper-view] { inset: 0; width: 100vw; border-radius: 0; } .wp-panel { padding: 10px; } .wp-header { flex-wrap: wrap; } .wp-search { flex: 1 1 160px; } .wp-spacer { display: none; } .wp-grid { grid-template-columns: repeat(auto-fill, minmax(min(190px, 100%), 1fr)); } .wp-local { align-items: stretch; } .wp-local .wp-path { flex: 1 1 100%; } }',
      '@media (prefers-reduced-motion: reduce) { .wp-spin { animation: none; border-top-color: currentColor; } }',
    ].join('\n')

    function injectStyles() {
      if (document.getElementById('dsh-wallpaper-styles') !== null) return
      var style = document.createElement('style')
      style.id = 'dsh-wallpaper-styles'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ------------------------------------------------------------- helpers
    function el(tag, attrs, children) {
      var node = document.createElement(tag)
      if (attrs) {
        for (var key in attrs) {
          if (key === 'text') node.textContent = attrs[key]
          else if (key === 'dataset') Object.assign(node.dataset, attrs[key])
          else if (key === 'html') node.innerHTML = attrs[key]
          else node.setAttribute(key, attrs[key])
        }
      }
      ;(children || []).forEach(function (child) {
        if (child == null) return
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
      })
      return node
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    // ------------------------------------------------------------- API
    var API = {
      status: '/api/dsh-wallpaper/status',
      list: '/api/dsh-wallpaper/list',
      apply: '/api/dsh-wallpaper/apply',
      upload: '/api/dsh-wallpaper/upload',
      skin: '/api/dsh-wallpaper/skin',
    }

    async function readJson(response) {
      var body
      try {
        body = await response.json()
      } catch {
        throw new Error('HTTP ' + response.status + ': invalid JSON response')
      }
      if (!response.ok) {
        throw new Error((body && typeof body.error === 'string') ? body.error : ('HTTP ' + response.status))
      }
      return body
    }

    function query(params) {
      var search = new URLSearchParams()
      for (var key in params) {
        if (params[key] !== undefined && params[key] !== '') search.set(key, String(params[key]))
      }
      var text = search.toString()
      return text === '' ? '' : '?' + text
    }

    // ----------------------------------------------- shared Harness backdrop
    var LEGACY_SKIN_KEY = 'dsh.wallpaperskin.skin'
    var SKIN_EVENT = 'dsh-wallpaper-skin-state'
    var MEDIA_ERROR_EVENT = 'dsh-wallpaper-media-error'
    var skinRuntime = {
      layer: undefined,
      image: undefined,
      video: undefined,
      ambient: undefined,
      still: undefined,
      scrim: undefined,
      skin: undefined,
      request: undefined,
      channel: undefined,
      motion: undefined,
      failedVideo: undefined,
      gifTimer: undefined,
      gifRestartTimer: undefined,
      gif: undefined,
      mediaGeneration: 0,
      palette: undefined,
    }

    function mixRgb(color, target, amount) {
      return color.map(function (value, index) { return Math.round(value * (1 - amount) + target[index] * amount) })
    }

    function rgba(color, alpha) {
      return 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + alpha + ')'
    }

    function relativeLuminance(color) {
      var channels = color.map(function (value) {
        var normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }

    function contrastRatio(first, second) {
      var a = relativeLuminance(first)
      var b = relativeLuminance(second)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }

    function ensureContrast(color, background, minimum, target) {
      var result = color
      for (var step = 0; step < 14 && contrastRatio(result, background) < minimum; step++) {
        result = mixRgb(result, target, 0.12)
      }
      return result
    }

    function hexToRgb(value) {
      var match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value || '')
      return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : undefined
    }

    function rotateHue(color, degrees) {
      var r = color[0] / 255
      var g = color[1] / 255
      var b = color[2] / 255
      var max = Math.max(r, g, b)
      var min = Math.min(r, g, b)
      var light = (max + min) / 2
      var delta = max - min
      if (delta === 0) return mixRgb(color, [98, 199, 165], 0.55)
      var saturation = delta / (1 - Math.abs(2 * light - 1))
      var hue = max === r ? 60 * (((g - b) / delta) % 6) : (max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4))
      hue = ((hue + degrees) % 360 + 360) % 360
      var chroma = (1 - Math.abs(2 * light - 1)) * saturation
      var x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
      var m = light - chroma / 2
      var rgb = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
      return rgb.map(function (value) { return Math.round((value + m) * 255) })
    }

    function applyWallpaperPalette(color) {
      if (!document.body || !Array.isArray(color)) return
      skinRuntime.palette = color
      var skin = skinRuntime.skin || {}
      var manual = skin.paletteMode === 'manual' ? hexToRgb(skin.accentColor) : undefined
      var manualSecondary = skin.paletteMode === 'manual' ? hexToRgb(skin.secondaryAccentColor) : undefined
      var preset = skin.paletteMode === 'auto' && skin.preset && typeof skin.preset === 'object' ? skin.preset : undefined
      var presetAccent = preset ? hexToRgb(preset.accentColor) : undefined
      var presetSecondary = preset ? hexToRgb(preset.secondaryAccentColor) : undefined
      var themeColor = manual || presetAccent || color
      var panelOpacity = typeof skin.panelOpacity === 'number' ? skin.panelOpacity : 0.52
      var inputOpacity = typeof skin.inputOpacity === 'number' ? skin.inputOpacity : 0.84
      var blur = typeof skin.blur === 'number' ? skin.blur : 8
      var dark = document.body.dataset.dsDarkTheme !== undefined
      // Keep enough of the wallpaper hue in light surfaces that changing a
      // wallpaper changes the whole UI, rather than merely tinting it gray.
      var surface = mixRgb(themeColor, dark ? [10, 15, 27] : [255, 255, 255], dark ? 0.62 : 0.58)
      var accent = mixRgb(themeColor, dark ? [232, 240, 255] : [18, 38, 62], dark ? 0.30 : 0.48)
      accent = ensureContrast(accent, surface, 4.5, dark ? [255, 255, 255] : [0, 0, 0])
      var accentHover = mixRgb(accent, dark ? [255, 255, 255] : [0, 0, 0], 0.14)
      var secondarySource = manualSecondary || presetSecondary || rotateHue(themeColor, 42)
      var secondary = mixRgb(secondarySource, dark ? [236, 244, 255] : [16, 36, 58], dark ? 0.28 : 0.46)
      secondary = ensureContrast(secondary, [255, 255, 255], 4.5, [0, 0, 0])
      var secondaryHover = mixRgb(secondary, dark ? [255, 255, 255] : [0, 0, 0], 0.14)
      var foregroundTarget = dark ? [247, 250, 255] : [8, 20, 38]
      var foregroundPrimary = mixRgb(themeColor, foregroundTarget, dark ? 0.76 : 0.70)
      foregroundPrimary = ensureContrast(foregroundPrimary, surface, 4.5, foregroundTarget)
      var foregroundSecondary = mixRgb(foregroundPrimary, surface, dark ? 0.26 : 0.30)
      foregroundSecondary = ensureContrast(foregroundSecondary, surface, 3, foregroundPrimary)
      var foregroundTertiary = mixRgb(foregroundSecondary, surface, dark ? 0.16 : 0.20)
      foregroundTertiary = ensureContrast(foregroundTertiary, surface, 3, foregroundPrimary)
      var foregroundDimmed = mixRgb(foregroundTertiary, surface, 0.42)
      var style = document.body.style
      // A glass surface needs both a real alpha channel and a stable tint.
      // The older factors were opaque enough to hide the blurred wallpaper,
      // especially in the conversation pane.
      style.setProperty('--wp-bg-base', rgba(surface, Math.max(0.045, panelOpacity * 0.24)))
      style.setProperty('--wp-bg-layer-1', rgba(surface, Math.max(0.10, panelOpacity * 0.52)))
      style.setProperty('--wp-bg-layer-2', rgba(surface, Math.max(0.16, panelOpacity * 0.74)))
      style.setProperty('--wp-bg-layer-3', rgba(surface, Math.min(0.88, panelOpacity * 0.88 + 0.08)))
      style.setProperty('--wp-sidebar', rgba(surface, Math.max(0.28, panelOpacity * 0.72)))
      style.setProperty('--wp-input', rgba(surface, inputOpacity))
      style.setProperty('--wp-overlay', rgba(surface, Math.min(0.98, panelOpacity + 0.44)))
      style.setProperty('--wp-code', rgba(surface, Math.min(0.96, panelOpacity + 0.38)))
      style.setProperty('--wp-code-inline', rgba(surface, Math.min(0.94, panelOpacity + 0.30)))
      style.setProperty('--wp-border-soft', rgba(accent, dark ? 0.40 : 0.28))
      style.setProperty('--wp-border-strong', rgba(accent, dark ? 0.64 : 0.50))
      style.setProperty('--wp-accent', 'rgb(' + accent.join(',') + ')')
      style.setProperty('--wp-accent-hover', 'rgb(' + accentHover.join(',') + ')')
      style.setProperty('--wp-accent-secondary', 'rgb(' + secondary.join(',') + ')')
      style.setProperty('--wp-accent-secondary-hover', 'rgb(' + secondaryHover.join(',') + ')')
      style.setProperty('--wp-fg-primary', 'rgb(' + foregroundPrimary.join(',') + ')')
      style.setProperty('--wp-fg-secondary', 'rgb(' + foregroundSecondary.join(',') + ')')
      style.setProperty('--wp-fg-tertiary', 'rgb(' + foregroundTertiary.join(',') + ')')
      style.setProperty('--wp-fg-dimmed', 'rgb(' + foregroundDimmed.join(',') + ')')
      style.setProperty('--wp-title-color', 'rgb(' + foregroundPrimary.join(',') + ')')
      style.setProperty('--wp-send-color', 'rgb(' + secondary.join(',') + ')')
      style.setProperty('--wp-accent-wash', rgba(accent, 0.22))
      style.setProperty('--wp-accent-wash-soft', rgba(accent, 0.14))
      style.setProperty('--wp-accent-wash-strong', rgba(accent, 0.32))
      style.setProperty('--wp-blur', blur + 'px')
    }

    function sampleWallpaperPalette(media) {
      try {
        var canvas = document.createElement('canvas')
        canvas.width = 48
        canvas.height = 48
        var context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return
        context.drawImage(media, 0, 0, canvas.width, canvas.height)
        var pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        var buckets = new Map()
        for (var i = 0; i < pixels.length; i += 16) {
          if (pixels[i + 3] < 160) continue
          var r = pixels[i]
          var g = pixels[i + 1]
          var b = pixels[i + 2]
          var max = Math.max(r, g, b)
          var min = Math.min(r, g, b)
          var light = (max + min) / 2
          if (light < 18 || light > 242) continue
          var key = (r >> 5) + '-' + (g >> 5) + '-' + (b >> 5)
          var saturation = max === 0 ? 0 : (max - min) / max
          var weight = 0.55 + saturation * 1.6
          var bucket = buckets.get(key) || { r: 0, g: 0, b: 0, weight: 0 }
          bucket.r += r * weight
          bucket.g += g * weight
          bucket.b += b * weight
          bucket.weight += weight
          buckets.set(key, bucket)
        }
        var best
        var vibrant
        buckets.forEach(function (bucket) {
          if (!best || bucket.weight > best.weight) best = bucket
          var average = [bucket.r / bucket.weight, bucket.g / bucket.weight, bucket.b / bucket.weight]
          var strongest = Math.max(average[0], average[1], average[2])
          var weakest = Math.min(average[0], average[1], average[2])
          var saturation = strongest === 0 ? 0 : (strongest - weakest) / strongest
          var vividScore = bucket.weight * (0.25 + saturation * 2.4)
          if (!vibrant || vividScore > vibrant.score) vibrant = { color: average, score: vividScore }
        })
        if (best) {
          var dominant = [
          Math.round(best.r / best.weight),
          Math.round(best.g / best.weight),
          Math.round(best.b / best.weight),
          ]
          var paletteColor = vibrant ? mixRgb(dominant, vibrant.color.map(Math.round), 0.55) : dominant
          applyWallpaperPalette(paletteColor)
        }
      } catch { /* media may be unavailable or canvas-protected; defaults remain readable */ }
    }

    function markAdaptiveSurfaces() {
      var roots = document.querySelectorAll('[data-pane="sidebar"], [data-pane="details"], [data-composer-seat], [data-shell-overlay]')
      for (var i = 0; i < roots.length; i++) {
        var candidates = [roots[i]].concat(Array.from(roots[i].querySelectorAll('*')))
        for (var j = 0; j < candidates.length; j++) {
          var node = candidates[j]
          if (!(node instanceof HTMLElement)) continue
          var rect = node.getBoundingClientRect()
          if (rect.width < 120 || rect.height < 36) continue
          var background = getComputedStyle(node).backgroundColor
          var alpha = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(background)
          if (background !== 'transparent' && (alpha === null || Number(alpha[1]) >= 0.08)) node.dataset.dshWallpaperSurface = ''
        }
      }
    }

    function dispatchSkin(skin) {
      document.dispatchEvent(new CustomEvent(SKIN_EVENT, { detail: skin }))
    }

    function stopVideo() {
      var video = skinRuntime.video
      if (video === undefined) return
      video.pause()
      video.removeAttribute('src')
      video.removeAttribute('poster')
      delete video.dataset.source
      try { video.load() } catch { /* detached media */ }
    }

    function clearGifLoop(keepDescriptor) {
      if (skinRuntime.gifTimer !== undefined) window.clearTimeout(skinRuntime.gifTimer)
      if (skinRuntime.gifRestartTimer !== undefined) window.clearTimeout(skinRuntime.gifRestartTimer)
      skinRuntime.gifTimer = undefined
      skinRuntime.gifRestartTimer = undefined
      if (!keepDescriptor) skinRuntime.gif = undefined
    }

    function resolveBackdropFit(skin, harness) {
      if (skin && (skin.backgroundFit === 'cover' || skin.backgroundFit === 'contain')) return skin.backgroundFit
      if (harness && harness.fit === 'ambient') return 'ambient'
      var width = harness && Number(harness.previewWidth)
      var height = harness && Number(harness.previewHeight)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 'cover'
      var viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1)
      var viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1)
      var sourceRatio = width / height
      var viewportRatio = viewportWidth / viewportHeight
      // Crop very similar ratios for a natural full-bleed image. Everything
      // else keeps its subject intact over a blurred copy of itself.
      return Math.max(sourceRatio / viewportRatio, viewportRatio / sourceRatio) > 1.12 ? 'ambient' : 'cover'
    }

    function applyBackdropFit(skin, harness, ambientUrl) {
      var layer = skinRuntime.layer
      var ambient = skinRuntime.ambient
      if (layer === undefined || ambient === undefined) return 'cover'
      var fit = resolveBackdropFit(skin, harness)
      if (fit === 'cover') delete layer.dataset.wpFit
      else layer.dataset.wpFit = fit
      if (fit === 'ambient' && typeof ambientUrl === 'string' && ambientUrl !== '') {
        ambient.src = ambientUrl
        delete ambient.dataset.wpHidden
      } else if (fit !== 'ambient') {
        ambient.dataset.wpHidden = ''
        ambient.removeAttribute('src')
      }
      return fit
    }

    function restartGifUrl(url) {
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_dshGifCycle=' + Date.now() + '-' + Math.random().toString(36).slice(2)
    }

    function captureGifStill(image, generation, done) {
      var still = skinRuntime.still
      var ambient = skinRuntime.ambient
      if (still === undefined || image.naturalWidth < 1 || image.naturalHeight < 1) { done(false); return }
      var settled = false
      function finish(ok) {
        if (settled) return
        settled = true
        done(ok && generation === skinRuntime.mediaGeneration && skinRuntime.image === image)
      }
      try {
        var canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        var context = canvas.getContext('2d')
        if (!context) { finish(false); return }
        context.drawImage(image, 0, 0)
        var snapshot = canvas.toDataURL('image/png')
        still.addEventListener('load', function () { finish(true) }, { once: true })
        still.addEventListener('error', function () { finish(false) }, { once: true })
        still.src = snapshot
        delete still.dataset.wpHidden
        still.style.opacity = '1'
        // The low-quality Scene ambient layer must use the same still image,
        // otherwise its blurred edges can flash while the foreground is safe.
        if (ambient !== undefined && skinRuntime.layer && skinRuntime.layer.dataset.wpFit === 'ambient') ambient.src = snapshot
        if (still.complete) window.setTimeout(function () { finish(true) }, 0)
      } catch {
        finish(false)
      }
    }

    function scheduleGifLoop(url, harness, image, generation) {
      var animation = harness && harness.animation
      if (!animation || animation.kind !== 'gif' || !Number.isFinite(animation.safeLoopMs) || animation.safeLoopMs < 1) return
      clearGifLoop()
      skinRuntime.gif = { url: url, harness: harness, image: image, generation: generation }
      var cutMs = Number.isFinite(animation.cutMs) ? animation.cutMs : 120
      var captureLeadMs = Math.min(80, Math.max(40, Math.round(cutMs * 0.35)))
      skinRuntime.gifTimer = window.setTimeout(function () {
        if (!skinRuntime.gif || skinRuntime.gif.generation !== generation || skinRuntime.image !== image || generation !== skinRuntime.mediaGeneration) return
        // Freeze the *current* near-tail frame before hiding the GIF. The
        // previous implementation reused a first-frame capture, which made
        // every short loop visibly jump even when it did not go black.
        captureGifStill(image, generation, function (captured) {
          if (!skinRuntime.gif || skinRuntime.gif.generation !== generation || generation !== skinRuntime.mediaGeneration) return
          // If a canvas capture is unavailable, retain the last decoded still
          // rather than exposing an empty layer. This degrades motion only;
          // it never risks hiding Harness or flashing a blank frame.
          if (!captured && skinRuntime.still === undefined) return
          image.style.opacity = '0'
          skinRuntime.gifRestartTimer = window.setTimeout(function () {
            if (!skinRuntime.gif || skinRuntime.gif.generation !== generation || generation !== skinRuntime.mediaGeneration) return
            showImage(restartGifUrl(url), harness, url)
          }, 0)
        })
      }, Math.max(1, animation.safeLoopMs - captureLeadMs))
    }

    function resumeGifLoop() {
      var gif = skinRuntime.gif
      if (!gif || !gif.harness || typeof gif.url !== 'string') return
      showImage(restartGifUrl(gif.url), gif.harness, gif.url)
    }

    function showImage(url, harness, canonicalUrl) {
      var image = skinRuntime.image
      var ambient = skinRuntime.ambient
      var video = skinRuntime.video
      var layer = skinRuntime.layer
      if (image === undefined || ambient === undefined || video === undefined || layer === undefined) return
      clearGifLoop()
      var generation = ++skinRuntime.mediaGeneration
      video.dataset.wpHidden = ''
      var next = el('img', { alt: '', dataset: { wpPrimary: '', wpHidden: '' } })
      layer.replaceChild(next, image)
      skinRuntime.image = next
      var lowQuality = harness && harness.fit === 'ambient'
      var animatedGif = harness && harness.animation && harness.animation.kind === 'gif'
      var reduceMotion = skinRuntime.motion !== undefined && skinRuntime.motion.matches
      if (lowQuality) layer.dataset.wpLowQuality = ''
      else delete layer.dataset.wpLowQuality
      var useAmbient = layer.dataset.wpFit === 'ambient'
      ambient.dataset.wpHidden = ''
      ambient.removeAttribute('src')
      if (!animatedGif && skinRuntime.still !== undefined) {
        skinRuntime.still.dataset.wpHidden = ''
        skinRuntime.still.style.opacity = '0'
        skinRuntime.still.removeAttribute('src')
      }
      if (typeof url !== 'string' || url === '') return
      if (useAmbient) {
        ambient.src = url
        delete ambient.dataset.wpHidden
      }
      next.addEventListener('load', function () {
        if (generation !== skinRuntime.mediaGeneration || skinRuntime.image !== next) return
        delete next.dataset.wpHidden
        next.style.opacity = '1'
        layer.hidden = false
        if (document.body) document.body.dataset.dshWallpaperSkin = ''
        sampleWallpaperPalette(next)
        if (!animatedGif) return
        captureGifStill(next, generation, function (captured) {
          if (generation !== skinRuntime.mediaGeneration || skinRuntime.image !== next) return
          if (!captured) {
            // Keeping Harness usable matters more than forcing a potentially
            // flashing GIF when the browser cannot create a safe still frame.
            next.dataset.wpHidden = ''
            layer.hidden = true
            if (document.body) delete document.body.dataset.dshWallpaperSkin
            document.dispatchEvent(new CustomEvent(MEDIA_ERROR_EVENT, { detail: '无法生成 GIF 安全帧，已关闭背景以避免闪屏' }))
            return
          }
          if (reduceMotion) {
            next.dataset.wpHidden = ''
            return
          }
          scheduleGifLoop(canonicalUrl || url, harness, next, generation)
        })
      })
      next.addEventListener('error', function () {
        if (generation !== skinRuntime.mediaGeneration || skinRuntime.image !== next) return
        next.dataset.wpHidden = ''
        ambient.dataset.wpHidden = ''
        ambient.removeAttribute('src')
        delete layer.dataset.wpLowQuality
        layer.hidden = true
        clearGifLoop()
        if (document.body) delete document.body.dataset.dshWallpaperSkin
        document.dispatchEvent(new CustomEvent(MEDIA_ERROR_EVENT, { detail: '背景媒体加载失败，已恢复默认界面' }))
      })
      next.src = url
    }

    function videoFallback() {
      var skin = skinRuntime.skin
      stopVideo()
      var harness = skin && skin.wallpaper && skin.wallpaper.harness
      showImage(harness && harness.posterUrl, harness)
    }

    function renderBackdrop(skin) {
      skinRuntime.skin = skin
      dispatchSkin(skin)
      var layer = skinRuntime.layer
      var image = skinRuntime.image
      var ambient = skinRuntime.ambient
      var video = skinRuntime.video
      if (layer === undefined || image === undefined || ambient === undefined || video === undefined || document.body === null) return
      var harness = skin && skin.wallpaper && skin.wallpaper.harness
      if (!skin || skin.enabled !== true || !harness || harness.compatible !== true || typeof harness.mediaUrl !== 'string') {
        skinRuntime.mediaGeneration += 1
        delete document.body.dataset.dshWallpaperSkin
        layer.hidden = true
        clearGifLoop()
        stopVideo()
        image.removeAttribute('src')
        ambient.removeAttribute('src')
        if (skinRuntime.still !== undefined) skinRuntime.still.removeAttribute('src')
        ambient.dataset.wpHidden = ''
        delete layer.dataset.wpLowQuality
        delete layer.dataset.wpFit
        return
      }
      document.body.dataset.dshWallpaperSkin = ''
      layer.hidden = false
      layer.style.setProperty('--wp-harness-scrim', String(skin.scrim))
      layer.style.setProperty('--wp-brightness', String(typeof skin.brightness === 'number' ? skin.brightness : 1))
      applyBackdropFit(skin, harness, harness.posterUrl || harness.mediaUrl)
      if (skin.paletteMode === 'manual') applyWallpaperPalette(hexToRgb(skin.accentColor) || skinRuntime.palette || [79, 140, 255])
      else if (skinRuntime.palette) applyWallpaperPalette(skinRuntime.palette)
      var reduceMotion = skinRuntime.motion !== undefined && skinRuntime.motion.matches
      if (harness.kind !== 'video' || reduceMotion || skinRuntime.failedVideo === harness.mediaUrl) {
        stopVideo()
        showImage(harness.posterUrl || harness.mediaUrl, harness)
        return
      }
      // A GIF callback can be waiting in its short safe-loop handoff when
      // the user picks a video. Invalidate that generation before making the
      // video visible, otherwise its delayed restart could replace the video
      // with the previous GIF after 120ms.
      clearGifLoop()
      skinRuntime.mediaGeneration += 1
      if (typeof harness.posterUrl === 'string') {
        var paletteImage = new Image()
        paletteImage.addEventListener('load', function () { sampleWallpaperPalette(paletteImage) })
        paletteImage.src = harness.posterUrl
      }
      image.dataset.wpHidden = ''
      ambient.dataset.wpHidden = ''
      ambient.removeAttribute('src')
      delete layer.dataset.wpLowQuality
      video.muted = true
      video.loop = true
      video.autoplay = true
      video.playsInline = true
      if (typeof harness.posterUrl === 'string') video.poster = harness.posterUrl
      applyBackdropFit(skin, harness, harness.posterUrl || undefined)
      if (video.dataset.source !== harness.mediaUrl) {
        video.dataset.source = harness.mediaUrl
        video.src = harness.mediaUrl
        video.load()
      }
      delete video.dataset.wpHidden
      if (!document.hidden) video.play().catch(function () {
        skinRuntime.failedVideo = harness.mediaUrl
        videoFallback()
      })
    }

    async function postSkin(payload) {
      var body = Object.assign({}, payload)
      if (skinRuntime.skin && Number.isSafeInteger(skinRuntime.skin.revision) && body.expectedRevision === undefined) {
        body.expectedRevision = skinRuntime.skin.revision
      }
      try {
        var response = await fetch(API.skin, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        var data = await readJson(response)
        renderBackdrop(data.skin)
        if (skinRuntime.channel) skinRuntime.channel.postMessage({ revision: data.skin.revision })
        return data.skin
      } catch (error) {
        refreshSkin()
        throw error
      }
    }

    async function migrateLegacySkin() {
      var saved
      try { saved = JSON.parse(localStorage.getItem(LEGACY_SKIN_KEY) || 'null') } catch { saved = null }
      if (!saved || typeof saved.id !== 'string' || saved.id === '') return undefined
      try {
        var migrated = await postSkin({ action: 'apply', id: saved.id, expectedRevision: 0 })
        try { localStorage.removeItem(LEGACY_SKIN_KEY) } catch { /* storage unavailable */ }
        return migrated
      } catch { return undefined }
    }

    async function refreshSkin() {
      if (skinRuntime.request !== undefined) return skinRuntime.request
      skinRuntime.request = (async function () {
        var response = await fetch(API.skin, { cache: 'no-store' })
        var body = await readJson(response)
        var skin = body.skin
        if (skin && skin.exists === false) {
          var migrated = await migrateLegacySkin()
          if (migrated !== undefined) skin = migrated
        } else {
          try { localStorage.removeItem(LEGACY_SKIN_KEY) } catch { /* old key no longer authoritative */ }
        }
        if (!skinRuntime.skin || skinRuntime.skin.revision !== skin.revision || skinRuntime.skin.enabled !== skin.enabled) renderBackdrop(skin)
        return skin
      })()
      try { return await skinRuntime.request } finally { skinRuntime.request = undefined }
    }

    function previewScrim(value) {
      if (skinRuntime.layer) skinRuntime.layer.style.setProperty('--wp-harness-scrim', String(value))
    }

    function mountBackdrop() {
      var layer = el('div', { dataset: { dshWallpaperBackdrop: '' }, 'aria-hidden': 'true' })
      var ambient = el('img', { alt: '', dataset: { wpAmbient: '', wpHidden: '' } })
      var still = el('img', { alt: '', dataset: { wpStill: '', wpHidden: '' } })
      var image = el('img', { alt: '', dataset: { wpPrimary: '', wpHidden: '' } })
      var video = el('video', { muted: '', loop: '', autoplay: '', playsinline: '', preload: 'metadata', dataset: { wpHidden: '' } })
      var scrim = el('div', { class: 'wp-backdropScrim' })
      layer.append(ambient, still, image, video, scrim)
      document.body.insertBefore(layer, document.body.firstChild)
      skinRuntime.layer = layer
      skinRuntime.image = image
      skinRuntime.ambient = ambient
      skinRuntime.still = still
      skinRuntime.video = video
      skinRuntime.scrim = scrim
      skinRuntime.motion = window.matchMedia('(prefers-reduced-motion: reduce)')
      window.addEventListener('resize', function () {
        var skin = skinRuntime.skin
        var harness = skin && skin.wallpaper && skin.wallpaper.harness
        if (!skin || !harness || skin.enabled !== true) return
        var current = harness.kind === 'video'
          ? harness.posterUrl
          : (skinRuntime.image && (skinRuntime.image.currentSrc || skinRuntime.image.src))
        applyBackdropFit(skin, harness, current)
      }, { passive: true })
      video.addEventListener('error', function () {
        var harness = skinRuntime.skin && skinRuntime.skin.wallpaper && skinRuntime.skin.wallpaper.harness
        skinRuntime.failedVideo = harness && harness.mediaUrl
        videoFallback()
      })
      function onVisibility() {
        if (document.hidden) {
          if (video.dataset.wpHidden === undefined) video.pause()
          clearGifLoop(true)
        } else if (video.dataset.wpHidden === undefined) {
          video.play().catch(videoFallback)
        } else {
          resumeGifLoop()
        }
      }
      function onMotion() {
        skinRuntime.failedVideo = undefined
        renderBackdrop(skinRuntime.skin)
      }
      var themeObserver = new MutationObserver(function (records) {
        if (records.some(function (record) { return record.attributeName === 'data-ds-dark-theme' }) && skinRuntime.palette) {
          applyWallpaperPalette(skinRuntime.palette)
        }
      })
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      var surfaceTimer
      function scheduleSurfaceScan() {
        if (surfaceTimer !== undefined) return
        // Streaming answers mutate the conversation frequently. A short
        // debounce keeps optional surface decoration from competing with
        // typing and rendering, while still adapting a newly mounted pane.
        surfaceTimer = window.setTimeout(function () {
          surfaceTimer = undefined
          markAdaptiveSurfaces()
        }, 120)
      }
      var surfaceObserver = new MutationObserver(scheduleSurfaceScan)
      surfaceObserver.observe(document.body, { childList: true, subtree: true })
      scheduleSurfaceScan()
      function onFocus() { refreshSkin().catch(function () { /* next poll retries */ }) }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('focus', onFocus)
      if (skinRuntime.motion.addEventListener) skinRuntime.motion.addEventListener('change', onMotion)
      else skinRuntime.motion.addListener(onMotion)
      if (typeof BroadcastChannel === 'function') {
        skinRuntime.channel = new BroadcastChannel('dsh-wallpaper-skin')
        skinRuntime.channel.addEventListener('message', function (event) {
          if (!skinRuntime.skin || event.data && event.data.revision > skinRuntime.skin.revision) onFocus()
        })
      }
      var timer = window.setInterval(onFocus, 4000)
      onFocus()

      return function () {
        window.clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('focus', onFocus)
        if (skinRuntime.motion.addEventListener) skinRuntime.motion.removeEventListener('change', onMotion)
        else skinRuntime.motion.removeListener(onMotion)
        if (skinRuntime.channel) skinRuntime.channel.close()
        themeObserver.disconnect()
        surfaceObserver.disconnect()
        if (surfaceTimer !== undefined) window.clearTimeout(surfaceTimer)
        clearGifLoop()
        document.querySelectorAll('[data-dsh-wallpaper-surface]').forEach(function (node) { delete node.dataset.dshWallpaperSurface })
        skinRuntime.channel = undefined
        stopVideo()
        delete document.body.dataset.dshWallpaperSkin
        layer.remove()
        skinRuntime.layer = undefined
        skinRuntime.image = undefined
        skinRuntime.ambient = undefined
        skinRuntime.still = undefined
        skinRuntime.video = undefined
        skinRuntime.skin = undefined
      }
    }

    // ---------------------------------------------------------- controller
    function PanelController() {
      this.panelOpen = false
      this.listeners = new Set()
    }
    PanelController.prototype.getSnapshot = function () { return { panelOpen: this.panelOpen } }
    PanelController.prototype.subscribe = function (fn) {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    }
    PanelController.prototype.open = function () {
      if (this.panelOpen) return
      this.panelOpen = true
      this.notify()
    }
    PanelController.prototype.close = function () {
      if (!this.panelOpen) return
      this.panelOpen = false
      this.notify()
    }
    PanelController.prototype.toggle = function () {
      if (this.panelOpen) this.close()
      else this.open()
    }
    PanelController.prototype.notify = function () {
      var listeners = [...this.listeners]
      for (var i = 0; i < listeners.length; i++) listeners[i]()
    }

    // ------------------------------------------------------ sidebar entry
    var ENTRY_SELECTOR = '[data-dsh-wallpaper-entry]'
    var ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="5.6" cy="6.2" r="1.1"/><path d="M3.2 12.5l3.4-3.4 2.2 2.2 2-2 2 3.2"/></svg>'

    function entryAnchor() {
      // SSH is the primary stable integration point.  It is a public data
      // attribute owned by the SSH plugin, not a CSS-module class name.
      var ssh = document.querySelector('[data-dsh-ssh-entry]')
      if (ssh instanceof HTMLElement && ssh.parentElement !== null) return ssh
      var taskboard = document.querySelector('[data-dsh-taskboard-entry]')
      if (taskboard instanceof HTMLElement && taskboard.parentElement !== null) return taskboard
      var newSession = document.querySelector('button[aria-label="新建会话"], button[aria-label="New session"]')
      if (!(newSession instanceof HTMLElement)) return undefined
      // Never append into logoRow.  Start at the button and select the first
      // ancestor that is a complete sibling row in the sidebar UI.
      var row = newSession
      while (row.parentElement !== null && row.parentElement.children.length === 1) row = row.parentElement
      return row
    }

    function createEntry(controller) {
      var entry = document.createElement('button')
      entry.type = 'button'
      entry.dataset.dshWallpaperEntry = ''
      entry.setAttribute('title', '壁纸（Harness · Wallpaper Engine · Windows 桌面）')
      entry.setAttribute('aria-label', '壁纸')
      entry.innerHTML = '<span class="wp-entryIcon">' + ICON + '</span><span class="wp-entryLabel">壁纸</span>'
      entry.addEventListener('click', () => { controller.toggle() })
      return entry
    }

    function placeEntry(anchor, entry) {
      var parent = anchor.parentElement
      if (parent === null) return false
      // The wallpaper row always follows SSH.  On installations without SSH,
      // it follows taskboard/new-session.  This invariant self-heals moves by
      // React and sibling plugins without depending on shell class hashes.
      if (entry.parentElement !== parent || entry.previousElementSibling !== anchor) {
        parent.insertBefore(entry, anchor.nextElementSibling)
      }
      return true
    }

    function mountSidebarEntry(controller) {
      var entry = createEntry(controller)
      var anchor
      var placed = false
      var rootObserver

      function tryPlace() {
        // The fallback "new session" row often renders before the optional
        // SSH plugin. Re-evaluate the preferred anchor on every host
        // mutation so a previously placed fallback entry moves below SSH as
        // soon as that stable public entry is available.
        var preferredAnchor = entryAnchor()
        if (preferredAnchor !== undefined && preferredAnchor !== anchor) {
          if (rootObserver) rootObserver.disconnect()
          anchor = preferredAnchor
          placed = false
        }
        if (anchor !== undefined && !anchor.isConnected) {
          rootObserver.disconnect()
          anchor = undefined
          placed = false
        }
        if (placed) {
          if (anchor !== undefined && anchor.isConnected && entry.parentElement === anchor.parentElement && entry.previousElementSibling === anchor) return
          rootObserver.disconnect()
          placed = false
        }
        anchor = anchor !== undefined ? anchor : preferredAnchor
        if (anchor === undefined) return
        placed = placeEntry(anchor, entry)
        if (placed && anchor.parentElement !== null) rootObserver.observe(anchor.parentElement, { childList: true, subtree: true })
      }

      rootObserver = new MutationObserver(function () {
        if (anchor === undefined || !anchor.isConnected) {
          placed = false
          tryPlace()
          return
        }
        if (entry.parentElement !== anchor.parentElement || entry.previousElementSibling !== anchor) placed = placeEntry(anchor, entry)
      })

      var waitObserver = new MutationObserver(function () { tryPlace() })
      waitObserver.observe(document.body, { childList: true, subtree: true })

      function syncActive() {
        if (controller.getSnapshot().panelOpen) entry.dataset.active = 'true'
        else delete entry.dataset.active
      }
      var unsubscribe = controller.subscribe(syncActive)
      syncActive()
      tryPlace()

      return function () {
        waitObserver.disconnect()
        rootObserver.disconnect()
        unsubscribe()
        entry.remove()
      }
    }

    // ---------------------------------------------------------- panel view
    var VIEW_SELECTOR = '[data-dsh-wallpaper-view]'
    var ACTIVE_ATTR = 'data-dsh-wallpaper-active'
    var OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
    var ACTIVATE_EVENT = 'dsh-panel-activate'
    var PANEL_NAME = 'wallpaper'

    function formatBytes(bytes) {
      if (!bytes) return ''
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
      return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }

    function typeLabel(type) {
      return ({ scene: '场景', video: '视频', web: '网页', image: '图片', audio: '音频', application: '应用' })[type] || type
    }

    function buildCard(item, state) {
      var thumb = el('div', { class: 'wp-thumb', dataset: { fallback: '无预览' } })
      if (item.previewUrl !== undefined) {
        var img = document.createElement('img')
        img.loading = 'lazy'
        img.alt = item.title
        img.src = item.previewUrl
        img.addEventListener('error', function () {
          thumb.dataset.failed = 'true'
          img.remove()
        })
        thumb.appendChild(img)
      } else {
        thumb.dataset.failed = 'true'
      }

      var meta = [el('span', { class: 'wp-tag' }, [typeLabel(item.type)])]
      var tags = (item.tags || []).slice(0, 3)
      for (var i = 0; i < tags.length; i++) meta.push(el('span', { class: 'wp-tag' }, [tags[i]]))
      if (item.harness && item.harness.previewWidth && item.harness.previewHeight) {
        meta.push(el('span', { class: 'wp-tag', dataset: item.harness.quality === 'low' ? { quality: 'low' } : {} }, [
          item.harness.previewWidth + '×' + item.harness.previewHeight + (item.harness.quality === 'low' ? ' 低清' : ''),
        ]))
      }
      if (item.sizeBytes) meta.push(el('span', {}, [formatBytes(item.sizeBytes)]))

      var harnessButton = el('button', { class: 'wp-btn wp-btn-primary wp-harness', type: 'button', dataset: { action: 'harness' } }, ['设为 Harness 背景'])
      var weButton = el('button', { class: 'wp-btn', type: 'button', dataset: { action: 'we' } }, ['WE 播放'])
      var nativeButton = el('button', { class: 'wp-btn', type: 'button', dataset: { action: 'native' } }, ['Windows 静态'])
      if (!item.harness || item.harness.compatible !== true) {
        harnessButton.disabled = true
        harnessButton.title = item.harness && item.harness.fallbackReason ? item.harness.fallbackReason : '没有可用于 Harness 的媒体'
      } else if (item.harness.fallbackReason) {
        harnessButton.title = item.harness.fallbackReason
      }
      if (item.nativeReady !== true) {
        nativeButton.disabled = true
        nativeButton.title = '该壁纸没有静态 jpg/png 预览，不能直接设为桌面（请用 WE 应用）'
      }
      var actions = el('div', { class: 'wp-actions' }, [harnessButton, weButton, nativeButton])

      var card = el('figure', { class: 'wp-card', role: 'listitem', dataset: { id: item.id, type: item.type } }, [
        thumb,
        el('figcaption', { class: 'wp-body' }, [
          el('div', { class: 'wp-cardTitle', title: item.title }, [item.title]),
          el('div', { class: 'wp-meta' }, meta),
          actions,
        ]),
      ])

      if (state.skin && state.skin.enabled && state.skin.wallpaperId === item.id) card.dataset.current = 'true'

      harnessButton.addEventListener('click', function () { applyHarnessWallpaper(item, state) })
      weButton.addEventListener('click', function () { applyWallpaper(item, 'we', state) })
      nativeButton.addEventListener('click', function () { applyWallpaper(item, 'native', state) })
      return card
    }

    function applyHarnessWallpaper(item, state) {
      var lowQuality = item.harness && item.harness.quality === 'low'
      setBanner(state, 'info', '正在把「' + item.title + '」设为 Harness 背景…' + (lowQuality ? ' 该 Scene 只有低清预览，将使用环境填充模式。' : ''))
      postSkin({ action: 'apply', id: item.id, scrim: state.scrimValue })
        .then(function (skin) {
          state.skin = skin
          setBanner(state, 'ok', '已将「' + item.title + '」设为 Harness 背景' + (lowQuality ? '（低清预览 · 环境填充）' : ''))
          renderList(state)
        })
        .catch(function (error) { setBanner(state, 'error', error.message) })
    }

    function applyWallpaper(item, mode, state) {
      setBanner(state, 'info', mode === 'we' ? '正在通过 Wallpaper Engine 应用「' + item.title + '」…' : '正在设为 Windows 桌面壁纸「' + item.title + '」…')
      fetch(API.apply, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id, mode: mode }),
      })
        .then(function (response) { return readJson(response) })
        .then(function (body) {
          var result = body.result || {}
          if (result.ok) setBanner(state, 'ok', result.message || '已应用')
          else setBanner(state, 'error', result.error || '应用失败')
        })
        .catch(function (error) { setBanner(state, 'error', error.message) })
    }

    function setBanner(state, kind, message) {
      if (state.banner === undefined) return
      state.banner.dataset.kind = kind
      state.banner.textContent = message
    }

    function renderList(state) {
      var grid = state.grid
      if (grid === undefined) return
      grid.textContent = ''
      var filtered = state.items
      var q = state.filterQ.trim().toLowerCase()
      if (state.filterType !== '') filtered = filtered.filter(function (item) { return item.type === state.filterType })
      if (q !== '') {
        filtered = filtered.filter(function (item) {
          return item.title.toLowerCase().includes(q)
            || item.id.toLowerCase().includes(q)
            || (item.tags || []).some(function (t) { return t.toLowerCase().includes(q) })
        })
      }
      if (state.loading) {
        grid.appendChild(el('div', { class: 'wp-loading' }, [el('span', { class: 'wp-spin' }), ' 加载中…']))
        return
      }
      if (filtered.length === 0) {
        var emptyText = state.items.length === 0 ? '未发现壁纸（检查 Wallpaper Engine 安装）' : (state.emptyTitle || '没有匹配的壁纸')
        grid.appendChild(el('div', { class: 'wp-empty' }, [emptyText]))
        return
      }
      var fragment = document.createDocumentFragment()
      for (var i = 0; i < filtered.length; i++) fragment.appendChild(buildCard(filtered[i], state))
      grid.appendChild(fragment)
    }

    function loadList(state) {
      if (state.listRequest !== undefined) return state.listRequest
      state.loading = state.items.length === 0
      if (state.loading) renderList(state)
      state.listRequest = fetch(API.list, { cache: 'no-store' })
        .then(function (response) { return readJson(response) })
        .then(function (body) {
          var nextItems = body.wallpapers || []
          var nextSignature = nextItems.map(function (item) {
            return item.id + ':' + (item.preview || '') + ':' + (item.sizeBytes || '')
          }).join('|')
          var changed = state.librarySignature !== undefined && state.librarySignature !== nextSignature
          state.librarySignature = nextSignature
          state.items = nextItems
          state.loading = false
          if (state.count) state.count.textContent = '共 ' + state.items.length + ' 张'
          if (state.banner && state.banner.textContent === '正在加载…') {
            setBanner(state, 'info', '选择壁纸可设为 Harness 背景，也可交给 Wallpaper Engine 或 Windows 桌面。')
          } else if (changed && state.banner) {
            setBanner(state, 'ok', '已同步 Wallpaper Engine 素材库（共 ' + state.items.length + ' 张）')
          }
          renderList(state)
        })
        .catch(function (error) {
          state.loading = false
          setBanner(state, 'error', '加载壁纸列表失败：' + error.message)
          renderList(state)
        })
        .finally(function () { state.listRequest = undefined })
      return state.listRequest
    }

    function loadStatus(state) {
      fetch(API.status)
        .then(function (response) { return readJson(response) })
        .then(function (body) {
          var status = body.status || {}
          var engine = status.engine || {}
          if (state.statusBadge) {
            if (engine.found) {
              state.statusBadge.textContent = 'WE ' + (engine.version || '') + ' · ' + (status.engineCurrent || []).length + ' 屏使用中'
              state.statusBadge.dataset.kind = 'ok'
            } else {
              state.statusBadge.textContent = '未发现 Wallpaper Engine，仅原生模式'
              state.statusBadge.dataset.kind = 'error'
            }
          }
        })
        .catch(function () { /* status is non-critical */ })
    }

    function syncPanelSkin(state, skin) {
      state.skin = skin
      state.scrimValue = skin && typeof skin.scrim === 'number' ? skin.scrim : 0.35
      state.panelOpacityValue = skin && typeof skin.panelOpacity === 'number' ? skin.panelOpacity : 0.52
      state.inputOpacityValue = skin && typeof skin.inputOpacity === 'number' ? skin.inputOpacity : 0.84
      state.blurValue = skin && typeof skin.blur === 'number' ? skin.blur : 8
      state.brightnessValue = skin && typeof skin.brightness === 'number' ? skin.brightness : 1
      state.backgroundFitValue = skin && (skin.backgroundFit === 'cover' || skin.backgroundFit === 'contain') ? skin.backgroundFit : 'auto'
      state.paletteModeValue = skin && skin.paletteMode === 'manual' ? 'manual' : 'auto'
      state.accentColorValue = skin && typeof skin.accentColor === 'string' ? skin.accentColor : '#4f8cff'
      state.secondaryAccentColorValue = skin && typeof skin.secondaryAccentColor === 'string' ? skin.secondaryAccentColor : '#62c7a5'
      state.presetIdValue = skin && skin.preset && typeof skin.preset.id === 'string' ? skin.preset.id : ''
      state.presets = skin && Array.isArray(skin.presets) ? skin.presets : []
      state.emptyTitle = skin && skin.preset && typeof skin.preset.emptyTitle === 'string' ? skin.preset.emptyTitle : ''
      if (state.title) state.title.textContent = skin && skin.preset && typeof skin.preset.title === 'string' ? skin.preset.title : '壁纸'
      if (state.footer) state.footer.textContent = skin && skin.preset && typeof skin.preset.footerText === 'string'
        ? skin.preset.footerText
        : '仅调整颜色与文案；不会替换 Harness 的布局或交互。'
      if (state.scrimInput) state.scrimInput.value = String(state.scrimValue)
      if (state.scrimText) state.scrimText.textContent = Math.round(state.scrimValue * 100) + '%'
      if (state.panelOpacityInput) state.panelOpacityInput.value = String(state.panelOpacityValue)
      if (state.panelOpacityText) state.panelOpacityText.textContent = Math.round(state.panelOpacityValue * 100) + '%'
      if (state.inputOpacityInput) state.inputOpacityInput.value = String(state.inputOpacityValue)
      if (state.inputOpacityText) state.inputOpacityText.textContent = Math.round(state.inputOpacityValue * 100) + '%'
      if (state.blurInput) state.blurInput.value = String(state.blurValue)
      if (state.blurText) state.blurText.textContent = state.blurValue + 'px'
      if (state.brightnessInput) state.brightnessInput.value = String(state.brightnessValue)
      if (state.brightnessText) state.brightnessText.textContent = Math.round(state.brightnessValue * 100) + '%'
      if (state.backgroundFitInput) state.backgroundFitInput.value = state.backgroundFitValue
      if (state.presetInput) {
        state.presetInput.textContent = ''
        state.presetInput.appendChild(el('option', { value: '' }, ['自动适配（无预设）']))
        for (var p = 0; p < state.presets.length; p++) state.presetInput.appendChild(el('option', { value: state.presets[p].id }, [state.presets[p].title]))
        state.presetInput.value = state.presetIdValue
      }
      if (state.paletteModeInput) state.paletteModeInput.value = state.paletteModeValue
      if (state.accentColorInput) {
        state.accentColorInput.value = state.accentColorValue
        state.accentColorInput.disabled = state.paletteModeValue !== 'manual'
      }
      if (state.secondaryAccentColorInput) {
        state.secondaryAccentColorInput.value = state.secondaryAccentColorValue
        state.secondaryAccentColorInput.disabled = state.paletteModeValue !== 'manual'
      }
      renderList(state)
    }

    function previewAppearance(state) {
      if (!skinRuntime.skin) return
      skinRuntime.skin = Object.assign({}, skinRuntime.skin, {
        panelOpacity: state.panelOpacityValue,
        inputOpacity: state.inputOpacityValue,
        blur: state.blurValue,
        brightness: state.brightnessValue,
        backgroundFit: state.backgroundFitValue,
        paletteMode: state.paletteModeValue,
        accentColor: state.accentColorValue,
        secondaryAccentColor: state.secondaryAccentColorValue,
      })
      applyWallpaperPalette(skinRuntime.palette || hexToRgb(state.accentColorValue) || [79, 140, 255])
    }

    function mountPanelView(controller) {
      var state = {
        items: [],
        loading: false,
        filterQ: '',
        filterType: '',
        banner: undefined,
        grid: undefined,
        count: undefined,
        statusBadge: undefined,
        skin: skinRuntime.skin,
        scrimValue: skinRuntime.skin && typeof skinRuntime.skin.scrim === 'number' ? skinRuntime.skin.scrim : 0.35,
        scrimInput: undefined,
        scrimText: undefined,
        panelOpacityValue: skinRuntime.skin && typeof skinRuntime.skin.panelOpacity === 'number' ? skinRuntime.skin.panelOpacity : 0.52,
        inputOpacityValue: skinRuntime.skin && typeof skinRuntime.skin.inputOpacity === 'number' ? skinRuntime.skin.inputOpacity : 0.84,
        blurValue: skinRuntime.skin && typeof skinRuntime.skin.blur === 'number' ? skinRuntime.skin.blur : 8,
        brightnessValue: skinRuntime.skin && typeof skinRuntime.skin.brightness === 'number' ? skinRuntime.skin.brightness : 1,
        backgroundFitValue: skinRuntime.skin && (skinRuntime.skin.backgroundFit === 'cover' || skinRuntime.skin.backgroundFit === 'contain') ? skinRuntime.skin.backgroundFit : 'auto',
        paletteModeValue: skinRuntime.skin && skinRuntime.skin.paletteMode === 'manual' ? 'manual' : 'auto',
        accentColorValue: skinRuntime.skin && typeof skinRuntime.skin.accentColor === 'string' ? skinRuntime.skin.accentColor : '#4f8cff',
        secondaryAccentColorValue: skinRuntime.skin && typeof skinRuntime.skin.secondaryAccentColor === 'string' ? skinRuntime.skin.secondaryAccentColor : '#62c7a5',
        presetIdValue: skinRuntime.skin && skinRuntime.skin.preset && typeof skinRuntime.skin.preset.id === 'string' ? skinRuntime.skin.preset.id : '',
        presets: skinRuntime.skin && Array.isArray(skinRuntime.skin.presets) ? skinRuntime.skin.presets : [],
        emptyTitle: skinRuntime.skin && skinRuntime.skin.preset && typeof skinRuntime.skin.preset.emptyTitle === 'string' ? skinRuntime.skin.preset.emptyTitle : '',
        panelOpacityInput: undefined,
        panelOpacityText: undefined,
        inputOpacityInput: undefined,
        inputOpacityText: undefined,
        blurInput: undefined,
        blurText: undefined,
        brightnessInput: undefined,
        brightnessText: undefined,
        backgroundFitInput: undefined,
        presetInput: undefined,
        paletteModeInput: undefined,
        accentColorInput: undefined,
        secondaryAccentColorInput: undefined,
        title: undefined,
        footer: undefined,
      }

      function buildPanel() {
        var statusBadge = el('span', { class: 'wp-tag', text: '检测中…' })
        state.statusBadge = statusBadge
        var closePanel = el('button', { class: 'wp-btn', type: 'button', 'aria-label': '关闭壁纸面板', title: '关闭壁纸面板', text: '关闭' })
        closePanel.addEventListener('click', function () { controller.close() })
        var title = el('h2', { class: 'wp-title' }, ['壁纸'])
        state.title = title
        var header = el('div', { class: 'wp-header' }, [
          title,
          statusBadge,
          closePanel,
        ])

        var search = el('input', { class: 'wp-search', type: 'search', placeholder: '搜索标题 / 标签…', 'aria-label': '搜索壁纸' })
        var typeSelect = el('select', { class: 'wp-select', 'aria-label': '按壁纸类型筛选' }, [
          el('option', { value: '' }, ['全部类型']),
          el('option', { value: 'scene' }, ['场景']),
          el('option', { value: 'video' }, ['视频']),
          el('option', { value: 'web' }, ['网页']),
          el('option', { value: 'image' }, ['图片']),
          el('option', { value: 'audio' }, ['音频']),
        ])
        var count = el('span', { class: 'wp-tag', text: '' })
        state.count = count
        var refresh = el('button', { class: 'wp-btn', type: 'button', text: '刷新' })
        var randomHarness = el('button', { class: 'wp-btn wp-btn-primary', type: 'button', text: '随机 Harness' })
        var randomDesktop = el('button', { class: 'wp-btn', type: 'button', text: '随机桌面' })
        var toolbar = el('div', { class: 'wp-toolbar' }, [
          search,
          typeSelect,
          el('span', { class: 'wp-spacer' }),
          count,
          refresh,
          randomHarness,
          randomDesktop,
        ])

        var banner = el('div', { class: 'wp-banner', dataset: { kind: 'info' }, role: 'status', 'aria-live': 'polite', text: '正在加载…' })
        state.banner = banner

        var scrimInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.scrimValue), 'aria-label': 'Harness 背景遮罩强度' })
        var scrimText = el('span', { text: Math.round(state.scrimValue * 100) + '%' })
        var clearHarness = el('button', { class: 'wp-btn', type: 'button', text: '清除 Harness 背景' })
        state.scrimInput = scrimInput
        state.scrimText = scrimText
        var scrimRow = el('div', { class: 'wp-scrim' }, [
          el('span', {}, ['背景暗化']),
          scrimInput,
          scrimText,
          clearHarness,
        ])

        var panelOpacityInput = el('input', { type: 'range', min: '0.15', max: '0.9', step: '0.01', value: String(state.panelOpacityValue), 'aria-label': '面板不透明度' })
        var panelOpacityText = el('span', { text: Math.round(state.panelOpacityValue * 100) + '%' })
        var inputOpacityInput = el('input', { type: 'range', min: '0.3', max: '1', step: '0.01', value: String(state.inputOpacityValue), 'aria-label': '输入区不透明度' })
        var inputOpacityText = el('span', { text: Math.round(state.inputOpacityValue * 100) + '%' })
        var blurInput = el('input', { type: 'range', min: '0', max: '32', step: '1', value: String(state.blurValue), 'aria-label': '背景毛玻璃强度' })
        var blurText = el('span', { text: state.blurValue + 'px' })
        var brightnessInput = el('input', { type: 'range', min: '0.5', max: '1.5', step: '0.01', value: String(state.brightnessValue), 'aria-label': '壁纸亮度' })
        var brightnessText = el('span', { text: Math.round(state.brightnessValue * 100) + '%' })
        var backgroundFitInput = el('select', { class: 'wp-select', 'aria-label': '壁纸适配方式' }, [
          el('option', { value: 'auto' }, ['自动适配']),
          el('option', { value: 'cover' }, ['铺满裁切']),
          el('option', { value: 'contain' }, ['完整显示']),
        ])
        backgroundFitInput.value = state.backgroundFitValue
        var presetInput = el('select', { class: 'wp-select', 'aria-label': '可选安全主题预设' }, [el('option', { value: '' }, ['自动适配（无预设）'])])
        for (var p = 0; p < state.presets.length; p++) presetInput.appendChild(el('option', { value: state.presets[p].id }, [state.presets[p].title]))
        presetInput.value = state.presetIdValue
        var paletteModeInput = el('select', { class: 'wp-select', 'aria-label': '主题配色模式' }, [
          el('option', { value: 'auto' }, ['自动取色']),
          el('option', { value: 'manual' }, ['手动主题色']),
        ])
        paletteModeInput.value = state.paletteModeValue
        var accentColorInput = el('input', { type: 'color', value: state.accentColorValue, 'aria-label': '手动主题色' })
        var secondaryAccentColorInput = el('input', { type: 'color', value: state.secondaryAccentColorValue, 'aria-label': '手动第二强调色' })
        accentColorInput.disabled = state.paletteModeValue !== 'manual'
        secondaryAccentColorInput.disabled = state.paletteModeValue !== 'manual'
        var resetAppearance = el('button', { class: 'wp-btn', type: 'button', text: '恢复自动适配' })
        state.panelOpacityInput = panelOpacityInput
        state.panelOpacityText = panelOpacityText
        state.inputOpacityInput = inputOpacityInput
        state.inputOpacityText = inputOpacityText
        state.blurInput = blurInput
        state.blurText = blurText
        state.brightnessInput = brightnessInput
        state.brightnessText = brightnessText
        state.backgroundFitInput = backgroundFitInput
        state.presetInput = presetInput
        state.paletteModeInput = paletteModeInput
        state.accentColorInput = accentColorInput
        state.secondaryAccentColorInput = secondaryAccentColorInput
        var appearance = el('details', { class: 'wp-appearance', open: '' }, [
          el('summary', {}, ['界面适配设置']),
          el('div', { class: 'wp-settingsGrid' }, [
            scrimRow,
            el('label', { class: 'wp-setting' }, [el('span', {}, ['面板不透明度']), panelOpacityInput, panelOpacityText]),
            el('label', { class: 'wp-setting' }, [el('span', {}, ['输入区不透明度']), inputOpacityInput, inputOpacityText]),
            el('label', { class: 'wp-setting' }, [el('span', {}, ['毛玻璃强度']), blurInput, blurText]),
            el('label', { class: 'wp-setting' }, [el('span', {}, ['壁纸亮度']), brightnessInput, brightnessText]),
            el('label', { class: 'wp-setting' }, [el('span', {}, ['壁纸适配']), backgroundFitInput]),
            el('label', { class: 'wp-setting' }, [el('span', {}, ['安全主题预设']), presetInput]),
            el('label', { class: 'wp-setting' }, [el('span', {}, ['主题配色']), paletteModeInput, accentColorInput]),
            el('label', { class: 'wp-setting' }, [el('span', {}, ['第二强调色']), el('span', {}, ['主按钮 / 发送']), secondaryAccentColorInput]),
            el('div', { class: 'wp-setting' }, [el('span', {}, ['自动流程']), el('span', {}, ['壁纸取色 → 面板/边框/标题/按钮']), resetAppearance]),
          ]),
        ])

        var grid = el('div', { class: 'wp-grid', role: 'list', 'aria-label': '壁纸图库' })
        state.grid = grid

        // local image row
        var fileInput = el('input', { class: 'wp-hidden', type: 'file', accept: '.jpg,.jpeg,.png,.bmp,.gif,.webp' })
        fileInput.style.display = 'none'
        var uploadButton = el('button', { class: 'wp-btn wp-btn-primary', type: 'button', text: '上传并设为 Harness' })
        var pathInput = el('input', { class: 'wp-path', type: 'text', placeholder: '或输入本地图片绝对路径…', 'aria-label': 'Windows 桌面图片绝对路径' })
        var applyPath = el('button', { class: 'wp-btn', type: 'button', text: '设为 Windows 桌面' })
        var localRow = el('div', { class: 'wp-local' }, [
          uploadButton,
          fileInput,
          pathInput,
          applyPath,
        ])

        var footer = el('p', { class: 'wp-presetNote', text: '仅调整颜色与文案；不会替换 Harness 的布局或交互。' })
        state.footer = footer
        var panel = el('div', { class: 'wp-panel', dataset: {} }, [header, toolbar, banner, appearance, grid, localRow, footer])

        search.addEventListener('input', function () {
          state.filterQ = search.value
          renderList(state)
        })
        typeSelect.addEventListener('change', function () {
          state.filterType = typeSelect.value
          renderList(state)
        })
        refresh.addEventListener('click', function () { loadList(state); loadStatus(state) })
        randomHarness.addEventListener('click', function () {
          setBanner(state, 'info', '正在随机选择 Harness 背景…')
          postSkin({ action: 'random', scrim: state.scrimValue })
            .then(function (skin) {
              state.skin = skin
              setBanner(state, 'ok', '已随机设置 Harness 背景：' + (skin.wallpaper ? skin.wallpaper.title : skin.wallpaperId))
              renderList(state)
            })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        randomDesktop.addEventListener('click', function () {
          setBanner(state, 'info', '正在随机切换 Windows 桌面壁纸…')
          fetch(API.apply, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'random' }),
          })
            .then(function (response) { return readJson(response) })
            .then(function (body) {
              var result = body.result || {}
              if (result.ok) setBanner(state, 'ok', result.message || '已随机切换 Windows 桌面')
              else setBanner(state, 'error', result.error || '随机切换失败')
            })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        scrimInput.addEventListener('input', function () {
          state.scrimValue = parseFloat(scrimInput.value)
          scrimText.textContent = Math.round(state.scrimValue * 100) + '%'
          previewScrim(state.scrimValue)
        })
        scrimInput.addEventListener('change', function () {
          postSkin({ action: 'apply', scrim: state.scrimValue })
            .then(function (skin) { state.skin = skin; setBanner(state, 'ok', 'Harness 遮罩已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        panelOpacityInput.addEventListener('input', function () {
          state.panelOpacityValue = parseFloat(panelOpacityInput.value)
          panelOpacityText.textContent = Math.round(state.panelOpacityValue * 100) + '%'
          previewAppearance(state)
        })
        panelOpacityInput.addEventListener('change', function () {
          postSkin({ action: 'apply', panelOpacity: state.panelOpacityValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '面板透明度已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        inputOpacityInput.addEventListener('input', function () {
          state.inputOpacityValue = parseFloat(inputOpacityInput.value)
          inputOpacityText.textContent = Math.round(state.inputOpacityValue * 100) + '%'
          previewAppearance(state)
        })
        inputOpacityInput.addEventListener('change', function () {
          postSkin({ action: 'apply', inputOpacity: state.inputOpacityValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '输入区透明度已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        blurInput.addEventListener('input', function () {
          state.blurValue = parseInt(blurInput.value, 10)
          blurText.textContent = state.blurValue + 'px'
          previewAppearance(state)
        })
        blurInput.addEventListener('change', function () {
          postSkin({ action: 'apply', blur: state.blurValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '毛玻璃强度已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        brightnessInput.addEventListener('input', function () {
          state.brightnessValue = parseFloat(brightnessInput.value)
          brightnessText.textContent = Math.round(state.brightnessValue * 100) + '%'
          previewAppearance(state)
          if (skinRuntime.layer) skinRuntime.layer.style.setProperty('--wp-brightness', String(state.brightnessValue))
        })
        brightnessInput.addEventListener('change', function () {
          postSkin({ action: 'apply', brightness: state.brightnessValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '壁纸亮度已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        backgroundFitInput.addEventListener('change', function () {
          state.backgroundFitValue = backgroundFitInput.value
          if (skinRuntime.layer) {
            if (state.backgroundFitValue === 'cover' || state.backgroundFitValue === 'contain') skinRuntime.layer.dataset.wpFit = state.backgroundFitValue
            else delete skinRuntime.layer.dataset.wpFit
          }
          postSkin({ action: 'apply', backgroundFit: state.backgroundFitValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '壁纸适配方式已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        presetInput.addEventListener('change', function () {
          postSkin({ action: 'apply', presetId: presetInput.value || null })
            .then(function (skin) { syncPanelSkin(state, skin); renderBackdrop(skin); setBanner(state, 'ok', skin.preset ? '已启用“' + skin.preset.title + '”安全预设' : '已恢复自动适配') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        paletteModeInput.addEventListener('change', function () {
          state.paletteModeValue = paletteModeInput.value
          accentColorInput.disabled = state.paletteModeValue !== 'manual'
          secondaryAccentColorInput.disabled = state.paletteModeValue !== 'manual'
          previewAppearance(state)
          postSkin({ action: 'apply', paletteMode: state.paletteModeValue, accentColor: state.accentColorValue, secondaryAccentColor: state.secondaryAccentColorValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', state.paletteModeValue === 'auto' ? '已恢复壁纸自动取色' : '已启用手动主题色') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        accentColorInput.addEventListener('input', function () {
          state.accentColorValue = accentColorInput.value
          previewAppearance(state)
        })
        accentColorInput.addEventListener('change', function () {
          postSkin({ action: 'apply', paletteMode: 'manual', accentColor: state.accentColorValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '手动主题色已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        secondaryAccentColorInput.addEventListener('input', function () {
          state.secondaryAccentColorValue = secondaryAccentColorInput.value
          previewAppearance(state)
        })
        secondaryAccentColorInput.addEventListener('change', function () {
          postSkin({ action: 'apply', paletteMode: 'manual', secondaryAccentColor: state.secondaryAccentColorValue })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '第二强调色已更新') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        resetAppearance.addEventListener('click', function () {
          postSkin({ action: 'apply', scrim: 0.35, panelOpacity: 0.52, inputOpacity: 0.84, blur: 8, brightness: 1, backgroundFit: 'auto', presetId: null, paletteMode: 'auto', accentColor: '#4f8cff', secondaryAccentColor: '#62c7a5' })
            .then(function (skin) { syncPanelSkin(state, skin); setBanner(state, 'ok', '已恢复自动适配默认值') })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        clearHarness.addEventListener('click', function () {
          postSkin({ action: 'clear' })
            .then(function (skin) { state.skin = skin; setBanner(state, 'ok', '已清除 Harness 背景'); renderList(state) })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })
        uploadButton.addEventListener('click', function () { fileInput.click() })
        fileInput.addEventListener('change', function () {
          var file = fileInput.files && fileInput.files[0]
          if (!file) return
          setBanner(state, 'info', '正在上传并设为 Harness 背景「' + file.name + '」…')
          fetch(API.upload + query({ name: file.name }), { method: 'POST', body: file })
            .then(function (response) { return readJson(response) })
            .then(function (body) {
              var wallpaper = body.wallpaper
              if (!wallpaper) throw new Error('上传响应缺少 wallpaper')
              return postSkin({ action: 'apply', id: wallpaper.id, scrim: state.scrimValue })
                .then(function (skin) {
                  state.skin = skin
                  setBanner(state, 'ok', '已上传并设为 Harness 背景「' + wallpaper.title + '」')
                  loadList(state)
                })
            })
            .catch(function (error) { setBanner(state, 'error', '上传失败：' + error.message) })
          fileInput.value = ''
        })
        applyPath.addEventListener('click', function () {
          var path = pathInput.value.trim()
          if (path === '') {
            setBanner(state, 'error', '请输入图片的绝对路径')
            return
          }
          setBanner(state, 'info', '正在设为桌面壁纸：' + path)
          fetch(API.apply, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'native', imagePath: path }),
          })
            .then(function (response) { return readJson(response) })
            .then(function (body) {
              var result = body.result || {}
              if (result.ok) setBanner(state, 'ok', result.message || '已应用')
              else setBanner(state, 'error', result.error || '应用失败')
            })
            .catch(function (error) { setBanner(state, 'error', error.message) })
        })

        return panel
      }

      var container
      var panel
      var loadedOnce = false
      var libraryTimer

      function syncLibrary() {
        if (!controller.getSnapshot().panelOpen || document.hidden) return
        loadList(state)
        loadStatus(state)
      }

      function startLibrarySync() {
        if (libraryTimer !== undefined) return
        libraryTimer = window.setInterval(syncLibrary, 6000)
      }

      function stopLibrarySync() {
        if (libraryTimer === undefined) return
        window.clearInterval(libraryTimer)
        libraryTimer = undefined
      }

      function ensure() {
        if (container !== undefined) {
          if (container.isConnected) return
          container.remove()
          container = undefined
          panel = undefined
        }
        container = document.createElement('div')
        container.dataset.dshWallpaperView = ''
        container.setAttribute('role', 'dialog')
        container.setAttribute('aria-label', '壁纸设置与图库')
        container.hidden = !controller.getSnapshot().panelOpen
        container.appendChild(panel !== undefined ? panel : (panel = buildPanel()))
        // A body-level drawer does not replace or hide the conversation DOM.
        // This makes it safe on shells that do not expose the legacy panes.
        document.body.appendChild(container)
        // The panel frame exists now — kick off the data loads exactly once
        // (the frame may mount after the initial apply, so load here, not in
        // the plugin apply).
        if (!loadedOnce) {
          loadedOnce = true
          loadStatus(state)
          loadList(state)
        }
      }

      var waitObserver = new MutationObserver(function () { ensure() })
      waitObserver.observe(document.body, { childList: true, subtree: true })

      function applyActive() {
        if (controller.getSnapshot().panelOpen) {
          document.documentElement.setAttribute(ACTIVE_ATTR, '')
          if (container !== undefined) {
            container.hidden = false
            var focus = container.querySelector('.wp-search')
            if (focus instanceof HTMLElement) focus.focus()
          }
          syncLibrary()
          startLibrarySync()
          document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
        } else {
          document.documentElement.removeAttribute(ACTIVE_ATTR)
          if (container !== undefined) container.hidden = true
          stopLibrarySync()
        }
      }

      function onOtherActivate(event) {
        if (event.detail !== PANEL_NAME && controller.getSnapshot().panelOpen) controller.close()
      }

      function onClickSidebarRow(event) {
        if (!controller.getSnapshot().panelOpen) return
        var target = event.target
        if (target === null) return
        if (typeof target.closest !== 'function') return
        var action = target.closest('button, a, [role="button"]')
        if (action !== null && action.closest('[data-pane="sidebar"]') !== null && action.closest(ENTRY_SELECTOR) === null) controller.close()
      }

      function onSkinState(event) {
        if (event.detail) syncPanelSkin(state, event.detail)
      }

      function onMediaError(event) {
        setBanner(state, 'error', typeof event.detail === 'string' ? event.detail : '背景媒体加载失败')
      }

      function onKeydown(event) {
        if (event.key === 'Escape' && controller.getSnapshot().panelOpen) controller.close()
      }

      function onVisibility() {
        if (!document.hidden) syncLibrary()
      }

      document.addEventListener('click', onClickSidebarRow, true)
      document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
      document.addEventListener(SKIN_EVENT, onSkinState)
      document.addEventListener(MEDIA_ERROR_EVENT, onMediaError)
      document.addEventListener('keydown', onKeydown)
      document.addEventListener('visibilitychange', onVisibility)
      var unsubscribe = controller.subscribe(applyActive)
      applyActive()
      ensure()

      return function () {
        document.removeEventListener('click', onClickSidebarRow, true)
        document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
        document.removeEventListener(SKIN_EVENT, onSkinState)
        document.removeEventListener(MEDIA_ERROR_EVENT, onMediaError)
        document.removeEventListener('keydown', onKeydown)
        document.removeEventListener('visibilitychange', onVisibility)
        waitObserver.disconnect()
        unsubscribe()
        stopLibrarySync()
        document.documentElement.removeAttribute(ACTIVE_ATTR)
        if (container !== undefined) { container.remove(); container = undefined }
      }
    }

    // ------------------------------------------------------------ plugin
    var inject = []

    function apply(ctx) {
      injectStyles()
      var controller = new PanelController()
      var disposers = []
      try {
        disposers.push(mountBackdrop())
        disposers.push(mountSidebarEntry(controller))
        disposers.push(mountPanelView(controller))
      } catch (error) {
        console.warn('[dsh-wallpaper] mount failed:', error)
      }
      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) disposers[i]()
          disposers.length = 0
        }
      }, 'backdrop-bridge-dsh: ui mounts')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
