/**
 * Built-in, data-only appearance presets.
 *
 * A preset can influence only strings and semantic colors. It cannot carry
 * CSS, HTML, JavaScript or a remote asset URL, so enabling one does not widen
 * the plugin trust boundary.
 */
const COLOR = /^#[0-9a-f]{6}$/i
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const LOCAL_ASSET = /^(?:assets\/)?[a-z0-9][a-z0-9._/-]*\.(?:svg|png|jpg|jpeg|webp)$/i

const RAW_PRESETS = [
  { id: 'midnight', accentColor: '#6f9cff', secondaryAccentColor: '#72d3b1', title: '午夜壁纸', emptyTitle: '没有匹配的壁纸', footerText: '自动取色会以这套预设作为安全基调。' },
  { id: 'aurora', accentColor: '#9a7cff', secondaryAccentColor: '#62d6d0', title: '极光壁纸', emptyTitle: '暂未发现可用壁纸', footerText: '极光预设仅调整颜色和文案，不改变 Harness 布局。' },
  { id: 'ember', accentColor: '#d77954', secondaryAccentColor: '#d9b45d', title: '暖色壁纸', emptyTitle: '未找到对应的暖色壁纸', footerText: '暖色预设仍保留原有聊天、文件和编辑器交互。' },
]

function cleanText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[<>]/.test(value) ? value : undefined
}

export function isSafeLocalAsset(value) {
  return typeof value === 'string' && LOCAL_ASSET.test(value) && !value.includes('..')
}

function normalizePreset(raw) {
  if (!raw || !ID.test(raw.id) || !COLOR.test(raw.accentColor) || !COLOR.test(raw.secondaryAccentColor)) return undefined
  const title = cleanText(raw.title, 80)
  const emptyTitle = cleanText(raw.emptyTitle, 160)
  const footerText = cleanText(raw.footerText, 240)
  if (!title || !emptyTitle || !footerText) return undefined
  const preset = { id: raw.id, accentColor: raw.accentColor.toLowerCase(), secondaryAccentColor: raw.secondaryAccentColor.toLowerCase(), title, emptyTitle, footerText }
  if (isSafeLocalAsset(raw.icon)) preset.icon = raw.icon
  return Object.freeze(preset)
}

/** Safe public DTOs; callers never receive the mutable source records. */
export const THEME_PRESETS = Object.freeze(RAW_PRESETS.map(normalizePreset).filter(Boolean))

export function resolveThemePreset(id) {
  if (typeof id !== 'string' || !ID.test(id)) return undefined
  return THEME_PRESETS.find(preset => preset.id === id)
}
