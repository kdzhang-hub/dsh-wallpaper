# Notices and third-party boundaries

## Scope of the Apache-2.0 license

The Apache-2.0 license in [`LICENSE`](LICENSE) applies only to code and documentation
authored for this repository, and only to the extent that each contributor has
the right to grant that license. It does not grant rights in third-party
software, trademarks, or user content.

## Wallpaper Engine and Steam Workshop content

This package does not ship Wallpaper Engine projects, Steam Workshop files,
preview images, videos, `scene.pkg` files, or user uploads. It only reads
locally installed material after the user installs and selects it. Users are
responsible for the licenses and permissions for every wallpaper they use or
redistribute.

Wallpaper Engine, Steam and Steam Workshop are trademarks or product names of
their respective owners. This project is independent and is not affiliated
with, endorsed by, or sponsored by their owners.

## DeepSeek Harness and package dependencies

The package integrates with DeepSeek Harness through public npm dependencies.
At development time the direct dependencies declared in `package.json` are
`@deepseek-ai/dsh-tools`, `@deepseek-ai/schemastery`, and the peer dependency
`@deepseek-ai/cordis`. They are not bundled into this package; package managers
resolve their own license notices. Before a release, maintainers should review
the resolved dependency tree and retain every notice required by those licenses.

DeepSeek and DeepSeek Harness are names of their respective owners. This
project is an independent plugin and does not claim official affiliation.

## Design reference

The README describes ATRI-Theme-DSH as a visual-behavior reference only. No
ATRI source code, assets, host-core patches, or generated selectors are
included in this package. If a future change imports any upstream material, its
source URL, exact revision, copyright notice, and license must be recorded in
this file before release.
