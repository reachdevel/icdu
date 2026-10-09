#!/usr/bin/env node
import { CONCURRENCY, du } from "./du";
import type { Live } from "./du";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP, USAGE } from "./help";
import { LiveTable } from "./live";
import { parseArgs } from "./options";
import { Progress } from "./progress";

async function main(): Promise<number> {
  if (process.platform !== "darwin") {
    process.stderr.write("icdu: only works on macOS\n");
    return 1;
  }

  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string };
    process.stdout.write(`icdu ${pkg.version}\n`);
    return 0;
  }
  if (parsed.kind === "error") process.stderr.write(`icdu: ${parsed.message}\n`);
  if (parsed.kind === "usage" || (parsed.kind === "error" && parsed.usage)) {
    process.stderr.write(USAGE);
    return 64;
  }
  if (parsed.kind === "error") return 64;

  process.env.UV_THREADPOOL_SIZE ??= String(CONCURRENCY);
  for (const warning of parsed.warnings) process.stderr.write(`icdu: ${warning}\n`);
  process.stdout.on("error", () => process.exit(0));

  // A terminal gets a live table when each operand prints a single line and the table fits on screen.
  const rows = parsed.paths.length + (parsed.options.total ? 1 : 0);
  const tty = process.stdout.isTTY && process.env.TERM !== "dumb" && !parsed.options.plain;
  const table =
    tty && parsed.options.depth === 0 && rows < (process.stdout.rows ?? 0) ? new LiveTable(process.stdout) : undefined;

  // On a terminal, read errors below an operand are counted instead of printed (the table row notes the count,
  // listings get one summary line). Redirected stderr, a pipe or --plain keeps du's one message per path.
  const collapse = Boolean(tty && process.stderr.isTTY);
  let unreadable = 0;

  const progress = new Progress(!parsed.options.plain);
  if (!table) {
    progress.start();
    process.once("SIGINT", () => {
      progress.stop();
      process.exit(130);
    });
  }

  const code = await du(
    parsed.paths,
    parsed.options,
    {
      out: (s) => {
        progress.clear();
        process.stdout.write(s);
      },
      err: (s) => {
        if (table) table.interject(() => process.stderr.write(s));
        else {
          progress.clear();
          process.stderr.write(s);
        }
      },
      warn: (s) => {
        if (collapse) unreadable++;
        else if (table) table.interject(() => process.stderr.write(s));
        else {
          progress.clear();
          process.stderr.write(s);
        }
      },
      tick: (n) => progress.update(n),
    },
    table as Live | undefined,
  );
  progress.stop();
  if (collapse && unreadable && !table) {
    const what = unreadable === 1 ? "1 entry could not be read" : `${unreadable} entries could not be read`;
    process.stderr.write(`icdu: ${what} (run with --plain to list them)\n`);
  }
  return code;
}

main().then((code) => {
  process.exitCode = code;
});
