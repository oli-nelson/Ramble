# Releases

Ramble's release model: maintain `CHANGELOG.md` under `Unreleased`,
build/test an exact source commit, and only then promote the changelog, tag, and
publish. No local release command edits files or pushes Git refs.

## Request a release

1. Review/consolidate `Unreleased` into concise user-facing notes. Keep released
   sections unchanged. Review the manual gates in [VALIDATION.md](VALIDATION.md).
2. Commit and push to the release branch. The branch must remain at that exact
   source commit until finalization; concurrent changes make publication fail safely.
3. Authenticate GitHub CLI, then run:

   ```sh
   bash scripts/release.sh 0.1.0
   # Or: bash scripts/release.sh 0.2.0-rc.1
   ```

   Alternatively use **Actions → Release → Run workflow**, select a branch, and
   enter the version (optional `v` prefix). The helper supplies an expected-SHA
   guard; it requires a clean checkout matching the branch on `origin`.
4. Follow the workflow. Never promote the changelog or create a release tag manually.

Versions are `X.Y.Z` or `X.Y.Z-{alpha,beta,rc}.N`, without leading zeroes; the
three numeric components are limited to 0–9999 for installer compatibility.
Prereleases are marked as such and do not become GitHub's latest stable release.

## Automated gates and artifacts

`.github/workflows/release.yml` has three phases:

- **Validate:** test release scripts hermetically, validate branch/version/source,
  reject existing tags, and prepare a read-only changelog/notes artifact.
- **Build:** macOS Intel (`macos-15-intel`), Apple Silicon (`macos-15`), and Windows
  x64 (`windows-latest`) independently run frontend build/tests, native tests with
  and without desktop features, rustfmt, strict Clippy, and Chromium workflows.
  Each then builds a production installer without `test-harness`.
- **Publish:** only after every matrix job succeeds, check the source branch again,
  commit only the promoted changelog, create annotated `v<version>`, and atomically
  push branch and tag with an exact old-value lease. Create a draft Release, upload
  all packages and SHA-256 checksums, then publish it with changelog-derived notes.

Artifacts are `ramble-<version>-{macos-x64,macos-arm64,windows-x64}.tar.gz` and
`SHA256SUMS`. Extract the archive to get a macOS `.dmg` or Windows NSIS `.exe`.
The version is applied to npm, Tauri, Cargo and their lockfiles **only in build
checkouts** before tests/builds. The release commit changes only `CHANGELOG.md`;
repository development versions are not automatically bumped.

**Packages are unsigned; macOS packages are not notarized.** Signing, OS policy
warnings, installation, real model calls, native focus/paste/hotkey behavior and
the other manual checks remain separate from passing automated jobs. Publishing
does not certify those checks or expand supported-platform guarantees.

## Repository setup and failure recovery

- Actions must be enabled, with access to the listed GitHub-hosted runners.
- The publish job uses `GITHUB_TOKEN` with `contents: write`. Repository rules must
  allow that job's changelog-only branch commit and annotated tag. No PAT, signing
  secret or protection bypass is configured; a rejected atomic push publishes nothing.
- Release runs are serialized, not cancelled by newer runs. Ordinary validation
  also tests the release scripts. No real model calls or OS input are used in tests.
- If any build/test fails, the changelog and remote refs remain unchanged.
- If the branch advances, fix/review changes and request a new run from its latest
  commit. Do not force/reset the branch to make an old run publish.
- If upload/publication fails after the atomic push, use **Re-run failed jobs** in
  the **same workflow run**. Finalization verifies the original source parent,
  run identity, changelog and branch ancestry before resuming an owned draft.
  Re-running every job will reject the now-existing tag; use failed-job retries.
- Published assets are never overwritten. Only a draft belonging to the same run
  may have uploads replaced during recovery. A different run/version owner fails
  closed. Expired artifacts or conflicting state require deliberate manual recovery,
  not deleting tags or rewriting released changelog sections automatically.

## Local validation of automation

```sh
bash scripts/test-release.sh
```

Requires Bash, Node, Git, jq, tar and shasum (available on the Ubuntu release runner).
Tests use disposable local remotes, fake installers and a fake `gh`; they exercise
version/changelog validation, manifest alignment, packaging, dispatch guards,
branch races, rejected pushes, draft-upload retry, and immutable published releases.
They do not build installers, contact GitHub, or validate a real hosted workflow.
