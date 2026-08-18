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

## Publish to npm

The configured npm package name is `backdrop-bridge-dsh`; the project and
repository remain named `dsh-wallpaper`. The unscoped npm name
`dsh-wallpaper` is already owned by another publisher, so do not attempt to
publish it without an explicit transfer of ownership.

After the release-owner fields and technical checks above pass, the release
owner can publish from the repository root in PowerShell:

```powershell
# Sign in with the npm account that will own the package. Complete any 2FA prompt.
npm login
npm whoami

# Check the name once more immediately before claiming it.
npm view backdrop-bridge-dsh version --json

# Publish the version from package.json. Do not paste passwords, tokens, or OTP codes into this repository.
npm publish --access public
```

If npm reports that the version already exists, increase `package.json`'s
`version`, commit that release change, rerun the checks, and publish the new
version. npm versions are immutable and cannot be overwritten. After a
successful publish, verify the public package and its installer:

```powershell
npm view backdrop-bridge-dsh version dist-tags --json
$version = node -p "require('./package.json').version"
npx "backdrop-bridge-dsh@$version" doctor
```

`npm publish` is an external, irreversible release operation. It is not run
by this repository's scripts and should be performed only by the account owner.

## Manual acceptance

On a disposable DSH Web Profile, run the documented install flow, restart the
host once, verify `doctor` reports success, open the sidebar entry, apply and
clear a Harness background, and confirm ordinary chat, SSH, file, editor,
dialog, and keyboard interactions remain usable. If testing desktop apply,
use a non-sensitive local wallpaper and verify the selected mode only changes
the intended desktop target.
