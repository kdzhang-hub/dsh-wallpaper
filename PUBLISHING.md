# Release checklist

This repository can be shared as source after the checks below pass. Publishing
to npm or a public forge is a separate external action and is intentionally not
performed by this project.

## Release-owner fields that cannot be guessed

Before the first public release, the copyright holder must:

1. Replace the copyright holder in [`LICENSE`](LICENSE) if
   `dsh-wallpaper contributors` is not the intended legal name.
2. Confirm that the source repository, homepage, and Issues URLs in
   `package.json` still point to `https://github.com/kdzhang-hub/dsh-wallpaper`.
3. Enable GitHub private vulnerability reporting for that repository and verify
   the reporting link in [`SECURITY.md`](SECURITY.md).
4. Confirm that every committed line of code and document is owned by its
   contributors or is covered by a compatible license. Record imported
   third-party material in [`NOTICE.md`](NOTICE.md).

## Technical checks

```powershell
npm test
node --check lib/index.js
node --check lib/engine.js
node --check lib/routes.js
node --check lib/tools.js
node --check lib/client.js
npm pack --dry-run --json
```

Confirm that the npm preview contains `LICENSE`, `NOTICE.md`, `README.md`,
`SECURITY.md`, `CHANGELOG.md`, source files, and no `node_modules`, local
profiles, wallpaper assets, test uploads, secrets, or machine-specific files.

Also run `npm view backdrop-bridge-dsh version --json` immediately before the
first publish. A 404 means the unscoped name was available at the time of the
check, not that it is reserved; only the actual publish transaction claims it.

## Manual acceptance

On a disposable DSH Web Profile, run the documented install flow, restart the
host once, verify `doctor` reports success, open the sidebar entry, apply and
clear a Harness background, and confirm ordinary chat, SSH, file, editor,
dialog, and keyboard interactions remain usable. If testing desktop apply,
use a non-sensitive local wallpaper and verify the selected mode only changes
the intended desktop target.
