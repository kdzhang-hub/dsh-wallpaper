#!/usr/bin/env node
/**
 * Profile-safe installer for the published package and local development.
 * It never guesses a user name or drive: DSH_HOME wins, then ~/.dsh.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const command = process.argv[2] ?? 'doctor'
const purge = process.argv.includes('--purge')
const packageName = 'backdrop-bridge-dsh'
const legacyBundleName = 'dsh-wallpaper'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
const profile = join(dshHome, 'profiles', 'web')
const manifestPath = join(profile, 'package.json')
const target = join(profile, 'node_modules', packageName)
const useSourceJunction = resolve(packageRoot) !== resolve(target) && existsSync(join(packageRoot, 'node_modules'))

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  try { renameSync(tmp, path) } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}
function inspect() {
  const manifest = readJson(manifestPath, undefined)
  const bundles = manifest?.dsh?.profile?.bundles
  return {
    dshHome,
    profile,
    profileFound: existsSync(profile),
    packageFound: existsSync(target),
    registered: Array.isArray(bundles) && bundles.includes(packageName),
    legacyBundleRegistered: Array.isArray(bundles) && bundles.includes(legacyBundleName),
    wallpaperEngineLikely: ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].some(existsSync),
  }
}
function print(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n') }

if (command === 'doctor') {
  print({ command, ...inspect(), ok: inspect().profileFound })
} else if (command === 'install') {
  if (!existsSync(profile)) throw new Error(`未发现 DSH Web Profile：${profile}。请先运行一次 dsh web，或设置 DSH_HOME。`)
  const manifest = readJson(manifestPath, {})
  // A local checkout already owns an installed dependency tree. Linking to it
  // avoids copying only this package and then failing at boot because its
  // runtime dependencies were deliberately excluded from the copy. A normal
  // npm-installed package executes from `target` and keeps its own dependency
  // layout, so it retains the portable file specifier.
  manifest.dependencies = {
    ...(manifest.dependencies || {}),
    [packageName]: useSourceJunction ? `link:${packageRoot}` : `file:node_modules/${packageName}`,
  }
  manifest.dsh = manifest.dsh || {}
  manifest.dsh.profile = manifest.dsh.profile || {}
  const existingBundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  const migratedLegacyBundle = existingBundles.includes(legacyBundleName)
  const bundles = existingBundles.filter(item => item !== legacyBundleName)
  if (!bundles.includes(packageName)) bundles.push(packageName)
  manifest.dsh.profile.bundles = bundles
  if (resolve(packageRoot) === resolve(target)) {
    // This is the installed package executing its own CLI. Copying it onto
    // itself would remove the running source on Windows; registration is
    // already sufficient and remains idempotent.
  } else if (existsSync(target) && !process.argv.includes('--force')) {
    // Existing package can be a junction in local development; retain it.
  } else {
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    if (useSourceJunction) symlinkSync(packageRoot, target, process.platform === 'win32' ? 'junction' : 'dir')
    else cpSync(packageRoot, target, { recursive: true, filter: src => !src.includes(`${join(packageRoot, 'node_modules')}`) })
  }
  writeJson(manifestPath, manifest)
  print({ command, migratedLegacyBundle, ...inspect(), message: '已注册映界桥（backdrop-bridge-dsh）；重启 dsh web 后在 SSH 下方打开“壁纸”。' })
} else if (command === 'uninstall') {
  const manifest = readJson(manifestPath, undefined)
  if (manifest !== undefined) {
    const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    manifest.dsh.profile.bundles = bundles.filter(item => item !== packageName)
    if (manifest.dependencies) delete manifest.dependencies[packageName]
    writeJson(manifestPath, manifest)
  }
  if (purge) {
    rmSync(target, { recursive: true, force: true })
    rmSync(join(dshHome, 'dsh-wallpaper'), { recursive: true, force: true })
  }
  print({ command, purge, ...inspect(), message: purge ? '已移除注册、包与托管缓存。' : '已移除注册；包与壁纸状态已保留。' })
} else {
  throw new Error('用法：backdrop-bridge-dsh <install|doctor|uninstall> [--force] [--purge]')
}
