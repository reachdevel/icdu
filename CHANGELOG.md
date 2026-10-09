# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased

First release.

### Added
- `icdu`, a `du` for macOS that counts files evicted to iCloud ("dataless" files) as if they were stored locally.
- The options of macOS `du(1)`: `-A -a -B -c -d -g -H -h -I -k -L -l -m -n -P -r -s -t -x --si` and the `BLOCKSIZE` environment variable,
  with output, ordering, hard-link handling and exit codes checked against `/usr/bin/du`.
- `--local` (or `ICDU_LOCAL=1`): count only what is stored on this Mac, exactly like `du`.
- `--plain` (or `ICDU_PLAIN=1`, or `CI` being set): no live table and no progress display.
- Parallel directory scan (16 concurrent filesystem calls).
- On a terminal: a live table for `-s` / `-d0` runs, where each operand's line fills in as soon as it has been scanned,
  with dim notes for symlinked operands and unreadable entries; a progress counter for listings.
- On a terminal, read errors below an operand are counted rather than printed (table note, or one summary line for listings);
  `--plain`, a pipe or redirected stderr keep `du`'s one message per path.
- `--help` and `--version`.
- macOS-only: `npm install` refuses other platforms, and the executable exits with a message.
