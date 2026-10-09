# Contributing

Thanks for helping. Bug reports, `du` mismatches and small, focused pull requests are all welcome.

## The one rule

**`icdu` behaves like macOS `du`.** The only intended difference is that files evicted to iCloud are counted as if they
were on disk (and `--local` removes even that). When something is unclear, run `/usr/bin/du` and copy what it does,
including its quirks. Don't improve on `du`.

## Setup

You need macOS (the tests run `/usr/bin/du`, `stat`, `chflags` and `hdiutil`) and Node.js 18 or newer.

```sh
git clone https://github.com/reachdevel/icdu.git
cd icdu
npm install
npm test        # builds, then runs everything
```

`npm test` never modifies or deletes anything outside temporary directories. Two tests use evicted files from your own
`~/Documents` or `~/Desktop` and skip themselves when there are none.

## Where things are

| | |
|---|---|
| `src/options.ts` | option parsing, `BLOCKSIZE`, `--local` / `--plain` |
| `src/du.ts` | the scan (concurrent) and the printing pass (in `du`'s order), hard-link table, iCloud detection |
| `src/format.ts` | `-h` / `--si` formatting |
| `src/live.ts`, `src/progress.ts`, `src/glyphs.ts` | terminal decorations (never used when output is piped) |
| `src/test/` | differential tests against `/usr/bin/du` |

## Changing behavior

1. Find out what `du` does, with a throwaway directory and `/usr/bin/du`. Try the odd cases too.
2. Add the invocation to the `CASES` list in `src/test/du.test.ts`. The test compares stdout, stderr and exit code with the real `du`.
3. Make it pass. If a behavior can't be matched, say so in the pull request and in the README's *Limitations*.

## Before you open a pull request

- [ ] `npm test` passes
- [ ] Changed or new behavior has a differential test against `du`
- [ ] Nothing decorative is written when stdout is not a terminal
- [ ] `CHANGELOG.md` has a line under *Unreleased* (or the next version)
- [ ] No new runtime dependencies (the package has none, on purpose)

## Releasing (maintainers)

1. Move the *Unreleased* notes in `CHANGELOG.md` under the new version with its date.
2. Bump `version` in `package.json` and commit.
3. Tag and push: `git tag v<version> && git push origin v<version>`.
4. The *Publish* workflow checks that the tag matches `package.json`, runs the tests on macOS and publishes to npm.

## Reporting problems

Use the issue forms. For a number that differs from `du`, include the command, both outputs, the output of
`icdu --local` and your macOS version. By contributing you agree that your work is released under the MIT license.
