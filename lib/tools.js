/**
 * Agent tools: wallpaper_list / wallpaper_apply / wallpaper_harness /
 * wallpaper_status — the
 * DSH-native counterpart of the GUI panel. They talk to the same engine the
 * web UI uses, so a wallpaper applied by an agent shows in the GUI's history
 * and vice versa.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** One text content block (the only render shape these tools emit). */
function text(value) {
  return [{ type: 'text', text: value }]
}

/** Render the wallpaper table for the model. */
function renderWallpapers(wallpapers) {
  if (wallpapers.length === 0) return 'no wallpapers found'
  const rows = wallpapers.map(item => [
    item.id,
    item.title,
    item.type,
    (item.tags.length > 0 ? item.tags.join(',') : '-'),
    item.previewUrl !== undefined ? 'yes' : 'no',
  ].join(' | '))
  return ['id | title | type | tags | preview', '--- | --- | --- | --- | ---', ...rows].join('\n')
}

/** wallpaper_list: enumerate the Wallpaper Engine library. */
export function wallpaperListTool(engine) {
  return defineTool({
    name: 'wallpaper_list',
    description: 'List wallpapers downloaded in Wallpaper Engine (workshop + local projects) with their id, title, type, tags. ' +
      'Use wallpaper_apply with an id to switch the desktop wallpaper. Triggers: 壁纸, wallpaper, 背景, list wallpapers.',
    parameters: {
      query: { type: 'string', description: 'Optional case-insensitive substring match against title, id, and tags.' },
      type: { type: 'string', description: 'Optional type filter: scene, video, web, image, audio, application.' },
      tag: { type: 'string', description: 'Optional exact tag filter (e.g. Anime).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          wallpapers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                type: { type: 'string', required: true },
                tags: { type: 'array', items: { type: 'string' }, required: true },
                source: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => text(renderWallpapers(value.wallpapers ?? [])),
    },
    async execute(args) {
      const all = await engine.list()
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const type = typeof args.type === 'string' ? args.type.trim() : ''
      const tag = typeof args.tag === 'string' ? args.tag.trim() : ''
      let wallpapers = all
      if (type !== '') wallpapers = wallpapers.filter(item => item.type === type)
      if (tag !== '') wallpapers = wallpapers.filter(item => item.tags.some(t => t.toLowerCase() === tag.toLowerCase()))
      if (query !== '') {
        wallpapers = wallpapers.filter(item =>
          item.title.toLowerCase().includes(query)
          || item.id.toLowerCase().includes(query)
          || item.tags.some(t => t.toLowerCase().includes(query)))
      }
      return {
        total: wallpapers.length,
        wallpapers: wallpapers.map(item => ({
          id: item.id,
          title: item.title,
          type: item.type,
          tags: item.tags,
          source: item.source,
        })),
      }
    },
  })
}

/** wallpaper_apply: switch the desktop wallpaper. */
export function wallpaperApplyTool(engine) {
  return defineTool({
    name: 'wallpaper_apply',
    description: 'Apply a wallpaper as the desktop background. Pass the id from wallpaper_list for a Wallpaper Engine wallpaper ' +
      '(mode=we, the default: Wallpaper Engine itself plays it, works for scene/video/web), or mode=native with imagePath for a ' +
      'static image file (sets the Windows desktop wallpaper directly), or mode=random to pick a random installed wallpaper. ' +
      'Triggers: 换壁纸, 设置壁纸, 替换背景, apply wallpaper, set wallpaper, random wallpaper.',
    parameters: {
      id: { type: 'string', description: 'Wallpaper id from wallpaper_list (e.g. workshop:12345). Required unless mode=random.' },
      mode: { type: 'string', enum: ['we', 'native', 'random'], description: 'we (default, via Wallpaper Engine), native (Windows desktop, static image only), random.' },
      imagePath: { type: 'string', description: 'Absolute path to a static image file for mode=native.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          mode: { type: 'string' },
          message: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.ok) return text(`[wallpaper applied] ${value.message ?? 'ok'}`)
        return text(`[wallpaper apply failed] ${value.error ?? 'unknown error'}`)
      },
    },
    async execute(args) {
      const mode = typeof args.mode === 'string' ? args.mode : 'we'
      if (mode === 'random') {
        return await engine.apply(undefined, 'random')
      }
      const imagePath = typeof args.imagePath === 'string' ? args.imagePath : undefined
      if (mode === 'native' && imagePath !== undefined) {
        return await engine.applyNative(imagePath)
      }
      const id = typeof args.id === 'string' ? args.id : ''
      if (id === '') {
        return { ok: false, error: 'id is required unless mode=random or imagePath is given' }
      }
      return await engine.apply(id, mode)
    },
  })
}

/** wallpaper_harness: control the shared DeepSeek Harness background. */
export function wallpaperHarnessTool(engine) {
  return defineTool({
    name: 'wallpaper_harness',
    description: 'Control the DeepSeek Harness interface background using the Wallpaper Engine library. ' +
      'action=apply uses an id from wallpaper_list, action=random chooses a compatible wallpaper, and action=clear restores the default Harness background. ' +
      'This does not change the Windows desktop wallpaper. Optional skin controls: scrim 0..1, panelOpacity 0.15..0.9, inputOpacity 0.3..1, blur 0..32, ' +
      'and paletteMode=auto or manual with accentColor/secondaryAccentColor=#RRGGBB. ' +
      'Triggers: Harness 壁纸, 界面背景, 聊天背景, DeepSeek 背景, apply Harness wallpaper.',
    parameters: {
      action: { type: 'string', enum: ['apply', 'random', 'clear'], description: 'apply, random, or clear.' },
      id: { type: 'string', description: 'Wallpaper id from wallpaper_list. Required for action=apply.' },
      scrim: { type: 'number', description: 'Optional dark veil opacity between 0 and 1.' },
      panelOpacity: { type: 'number', description: 'Optional translucent panel opacity between 0.15 and 0.9.' },
      inputOpacity: { type: 'number', description: 'Optional composer and input opacity between 0.3 and 1.' },
      blur: { type: 'number', description: 'Optional backdrop blur in pixels between 0 and 32.' },
      paletteMode: { type: 'string', enum: ['auto', 'manual'], description: 'auto derives colors from the wallpaper; manual uses accentColor.' },
      accentColor: { type: 'string', description: 'Optional manual six-digit hex accent color, for example #4f8cff.' },
      secondaryAccentColor: { type: 'string', description: 'Optional second manual six-digit hex accent used for primary action buttons.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string', required: true },
          revision: { type: 'integer' },
          wallpaperId: { type: 'string' },
          enabled: { type: 'boolean' },
          scrim: { type: 'number' },
          panelOpacity: { type: 'number' },
          inputOpacity: { type: 'number' },
          blur: { type: 'number' },
          paletteMode: { type: 'string' },
          accentColor: { type: 'string' },
          secondaryAccentColor: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string' },
          message: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => value.ok
        ? text(`[Harness wallpaper] ${value.message ?? 'ok'}`)
        : text(`[Harness wallpaper failed] ${value.error ?? 'unknown error'}`),
    },
    async execute(args) {
      const action = typeof args.action === 'string' ? args.action : 'apply'
      const scrim = args.scrim
      const appearance = {
        panelOpacity: args.panelOpacity,
        inputOpacity: args.inputOpacity,
        blur: args.blur,
        paletteMode: args.paletteMode,
        accentColor: args.accentColor,
        secondaryAccentColor: args.secondaryAccentColor,
      }
      let result
      if (action === 'clear') result = await engine.clearHarness()
      else if (action === 'random') result = await engine.randomHarness(scrim, appearance)
      else {
        const id = typeof args.id === 'string' ? args.id : ''
        if (id === '') return { ok: false, action, error: 'id is required for action=apply' }
        result = await engine.applyHarness(id, scrim, appearance)
      }
      if (!result.ok) return { ok: false, action, error: result.error }
      const skin = result.skin
      return {
        ok: true,
        action,
        revision: skin.revision,
        wallpaperId: skin.wallpaperId ?? undefined,
        enabled: skin.enabled,
        scrim: skin.scrim,
        panelOpacity: skin.panelOpacity,
        inputOpacity: skin.inputOpacity,
        blur: skin.blur,
        paletteMode: skin.paletteMode,
        accentColor: skin.accentColor,
        secondaryAccentColor: skin.secondaryAccentColor,
        title: skin.wallpaper?.title,
        kind: skin.wallpaper?.harness?.kind,
        message: action === 'clear'
          ? '已清除 DeepSeek Harness 背景'
          : `已将「${skin.wallpaper?.title ?? skin.wallpaperId}」设为 DeepSeek Harness 背景`,
      }
    },
  })
}

/** wallpaper_status: engine detection + current wallpapers. */
export function wallpaperStatusTool(engine) {
  return defineTool({
    name: 'wallpaper_status',
    description: 'Report Wallpaper Engine discovery status, the current native Windows wallpaper, and which wallpapers ' +
      'Wallpaper Engine is currently showing per monitor. Triggers: 壁纸状态, current wallpaper, wallpaper status.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          engineFound: { type: 'boolean', required: true },
          installDir: { type: 'string' },
          workshopDir: { type: 'string' },
          version: { type: 'string' },
          nativeCurrent: { type: 'string' },
          engineCurrent: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => text([
        `engine found: ${value.engineFound}`,
        value.installDir !== undefined ? `install dir: ${value.installDir}` : 'install dir: (not found)',
        value.workshopDir !== undefined ? `workshop dir: ${value.workshopDir}` : 'workshop dir: (not found)',
        value.version !== undefined ? `version: ${value.version}` : '',
        `native current: ${value.nativeCurrent ?? '(none)'}`,
        `engine current: ${(value.engineCurrent ?? []).join(', ') || '(none)'}`,
      ].filter(line => line !== '').join('\n')),
    },
    async execute() {
      const status = await engine.status()
      return {
        engineFound: status.engine.found,
        installDir: status.engine.installDir,
        workshopDir: status.engine.workshopDir,
        version: status.engine.version,
        nativeCurrent: status.nativeCurrent,
        engineCurrent: status.engineCurrent,
      }
    },
  })
}
