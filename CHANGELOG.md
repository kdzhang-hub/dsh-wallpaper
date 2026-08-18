# Changelog

All notable user-facing changes are recorded here.

## 0.6.0 - 2026-08-18

- Renamed the publishable npm package, CLI, and DSH bundle to
  `backdrop-bridge-dsh` after verifying that `dsh-wallpaper` is already
  registered on npm; its ownership was not assumed.
- The installer removes the legacy `dsh-wallpaper` bundle registration during
  migration but preserves old package files and the local API/state namespace.
- Restored `dsh-wallpaper` as the visible project name and added the public
  repository metadata for `kdzhang-hub/dsh-wallpaper`.
- Restored the Apache-2.0 license used by the published 0.1.1 release.

## 0.5.2 - 2026-08-18

- Named the product dsh-wallpaper.
- Added discovery keywords, a repository-safe `.gitignore`, and an initialized
  local Git repository; removed the unresolved helper-release URL placeholder.

## 0.5.1 - 2026-08-18

- Added the MIT license text and publication notices.
- Documented installation prerequisites, verification, local data handling,
  desktop side effects, security reporting, and release checks.
- Marked the legacy `dsh-wallpaper-skin` package as archived and corrected the
  bundle-patch version label.

## 0.5.0 - 2026-08-18

- Consolidated the active wallpaper and Harness-skin behavior in one package.
- Added a safe background layer, adaptive palette controls, low-resolution
  Scene preview fallback, local shared state, a guarded Scene-helper protocol,
  and a profile-oriented CLI.
