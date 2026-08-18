# Contributing

Thanks for improving `dsh-wallpaper`.

1. Do not add Wallpaper Engine projects, Steam Workshop downloads, user
   uploads, credentials, or machine-specific paths to commits.
2. Keep the host and browser halves compatible with the declared DSH package
   ranges. Do not broaden filesystem access, local HTTP exposure, or command
   execution without tests and documentation.
3. Run `npm test`, `node --check lib/index.js`, and
   `npm pack --dry-run --json` before proposing a release.
4. Update `README.md`, `NOTICE.md`, and `CHANGELOG.md` when behavior, local
   data handling, dependencies, or user-visible limits change.
5. A contribution that includes third-party code or assets must identify its
   source, revision, copyright holder, and compatible license before review.

When the project is hosted publicly, use its issue tracker for reproducible
bugs and its configured private security channel for vulnerabilities.
