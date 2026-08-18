/**
 * dsh-wallpaper — host half. Mounts the Wallpaper Engine bridge (scanner,
 * applier, /api/dsh-wallpaper route family), the agent tools
 * (wallpaper_list / wallpaper_apply / wallpaper_harness / wallpaper_status),
 * and a system-prompt
 * announcement. The browser half (./client) renders the wallpaper gallery
 * panel. Hand-written plain ESM — no build step.
 */

import z from '@deepseek-ai/schemastery'
import { WallpaperEngine } from './engine.js'
import { makeRoutes } from './routes.js'
import { wallpaperApplyTool, wallpaperHarnessTool, wallpaperListTool, wallpaperStatusTool } from './tools.js'

/** Stable cordis plugin name. */
export const name = 'wallpaper'

/** Services required before the wallpaper surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Plugin config, validated by the same-named schemastery schema. */
export const Config = z.object({
  /** When true (default), a system-prompt section announces the plugin to every agent. */
  announceToAgent: z.boolean().default(true),
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled: z.boolean().default(true),
  /** Optional override for the Wallpaper Engine install dir. */
  installDir: z.string(),
  /** Optional override for the workshop content dir (steamapps/workshop/content/431960). */
  workshopDir: z.string(),
  /** Optional override for the managed uploads dir (default ~/.dsh/dsh-wallpaper/uploads). */
  uploadsDir: z.string(),
  /** Optional trusted local RePKG helper. Never downloaded automatically in this release. */
  repkgPath: z.string(),
  /** Optional SHA-256 pin for the local RePKG helper. */
  repkgSha256: z.string(),
  /** Optional override for managed Scene extraction cache. */
  sceneCacheDir: z.string(),
})

/** Default for hand-built test contexts (the loader applies schema defaults). */
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 155

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const WALLPAPER_GUIDANCE = '本机已安装壁纸桥（backdrop-bridge-dsh 0.6.0，Wallpaper Bridge）插件：它连接 Wallpaper Engine 与 DeepSeek Harness 壁纸，侧边栏只有一个位于 SSH 下方的「壁纸」入口。wallpaper_list 扫描 Wallpaper Engine workshop、本地项目与插件上传图片，并返回稳定 id；wallpaper_harness 控制【DeepSeek Harness 界面背景】，支持 action=apply/random/clear 和 0..1 遮罩值，MP4 在界面中静音循环播放，Wallpaper Engine Scene 因浏览器不能直接解码而使用 preview.gif/jpg；wallpaper_apply 只控制【Windows 桌面背景】，mode=we 由 Wallpaper Engine 播放 scene/video/web，mode=native 使用 SystemParametersInfo 设置静图，mode=random 随机切换桌面；wallpaper_status 报告引擎发现状态与桌面壁纸。用户说「Harness 壁纸 / 界面背景 / 聊天背景」时使用 wallpaper_harness；用户明确说「Windows 桌面 / Wallpaper Engine 播放」时使用 wallpaper_apply。不要混淆两个目标。服务仅走本机回环接口。'

/**
 * Mount the engine, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx, config) {
  const current = () => config ?? {}
  const resolve = () => ({
    announceToAgent: current().announceToAgent ?? DEFAULT_ANNOUNCE,
    enabled: current().enabled ?? true,
    installDir: current().installDir,
    workshopDir: current().workshopDir,
    uploadsDir: current().uploadsDir,
    repkgPath: current().repkgPath,
    repkgSha256: current().repkgSha256,
    sceneCacheDir: current().sceneCacheDir,
  })

  let engine
  let disposeSection
  let disposeRoutes
  let disposeTools

  const sync = () => {
    const value = resolve()
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    if (engine !== undefined) { engine.close(); engine = undefined }
    if (!value.enabled) return
    // The engine is cheap to (re)create: discovery is lazy and cached inside.
    engine = new WallpaperEngine({
      installDir: value.installDir,
      workshopDir: value.workshopDir,
      uploadsDir: value.uploadsDir,
      repkgPath: value.repkgPath,
      repkgSha256: value.repkgSha256,
      sceneCacheDir: value.sceneCacheDir,
    })
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:backdrop-bridge-dsh',
        order: SECTION_ORDER,
        text: WALLPAPER_GUIDANCE,
      })
    }
    const { routes } = makeRoutes(engine)
    disposeRoutes = ctx.effect(() => {
      const disposers = routes.map(route => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'backdrop-bridge-dsh: routes')
    disposeTools = ctx.effect(() => {
      const disposers = [
        wallpaperListTool(engine),
        wallpaperApplyTool(engine),
        wallpaperHarnessTool(engine),
        wallpaperStatusTool(engine),
      ].map(tool => ctx.tools.register(tool))
      return () => { for (const dispose of disposers) dispose() }
    }, 'backdrop-bridge-dsh: tools')
  }

  ctx.effect(() => () => {
    if (disposeSection !== undefined) disposeSection()
    if (disposeRoutes !== undefined) disposeRoutes()
    if (disposeTools !== undefined) disposeTools()
    if (engine !== undefined) engine.close()
  }, 'backdrop-bridge-dsh: teardown')

  sync()
}
