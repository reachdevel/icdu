import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import { ARROW, WARN } from "./glyphs";
import { humanize } from "./format";
import type { Options } from "./options";

export interface IO {
  out(text: string): void;
  err(text: string): void;
  /** Read errors for entries below an operand; falls back to `err`. A terminal front end may count them instead of printing. */
  warn?(text: string): void;
  /** Called every so often while scanning, with the number of entries seen so far. */
  tick?(entries: number): void;
}

/** Row-per-operand display used instead of `IO.out` when stdout is a terminal and every operand prints one line. */
export interface Live {
  /** One row per label, in output order, all pending. */
  begin(labels: string[]): void;
  /** Settle a row with its final text (no newline), or `null` when `du` prints nothing for it. `note` is a side remark for humans. */
  resolve(row: number, text: string | null, note?: string): void;
  /** All rows are settled. `order` lists the row indexes in the order they should end up on screen (for -S). */
  end(order?: number[]): void;
}

/** One output line with the size it was printed for, so -S can sort numerically. */
interface Line {
  text: string;
  blocks: number;
}

const BLOCK = 512;
/** APFS allocation unit; used to size files that iCloud has evicted from disk. */
const ALLOC = 4096;
const UF_NODUMP = 0x1;
const UF_DATALESS = 0x40000000;
/** Concurrent filesystem operations during a scan; beyond ~16 APFS gains nothing. */
export const CONCURRENCY = 16;
/** Stay well below ARG_MAX (1 MiB, shared with the environment) per stat(1) invocation. */
const ARG_BUDGET = 256 * 1024;

const MESSAGES: Record<string, string> = {
  ENOENT: "No such file or directory",
  EACCES: "Permission denied",
  EPERM: "Operation not permitted",
  ENOTDIR: "Not a directory",
  ELOOP: "Too many levels of symbolic links",
  ENAMETOOLONG: "File name too long",
  EIO: "Input/output error",
};

function reason(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  return (err.code && MESSAGES[err.code]) || err.message;
}

/** The few stat fields we need. inode numbers on APFS exceed 2^53, so identity is kept as bigint. */
export interface Entry {
  isDir: boolean;
  isSymlink: boolean;
  isFile: boolean;
  nlink: number;
  size: number;
  blocks: number;
  dev: bigint;
  ino: bigint;
}

function toEntry(st: fs.BigIntStats): Entry {
  return {
    isDir: st.isDirectory(),
    isSymlink: st.isSymbolicLink(),
    isFile: st.isFile(),
    nlink: Number(st.nlink),
    size: Number(st.size),
    blocks: Number(st.blocks),
    dev: st.dev,
    ino: st.ino,
  };
}

/**
 * Files with no blocks but a real size are either evicted from iCloud (dataless) or fully sparse.
 * Only the former should be charged as if present; the flags tell which.
 */
export function isCandidate(e: Entry): boolean {
  return e.isFile && e.blocks === 0 && e.size > 0;
}

/** 512-byte blocks `du` would report; an evicted (dataless) file is charged as if it were on disk. */
export function blocksOf(e: Entry, dataless: boolean): number {
  return dataless ? (Math.ceil(e.size / ALLOC) * ALLOC) / BLOCK : e.blocks;
}

const execFileAsync = promisify(execFile);

/**
 * st_flags for each path (Node cannot read them), via stat(1) in a few big batches.
 * Paths stat(1) could not read are missing from the result.
 */
async function readFlags(paths: string[]): Promise<Map<string, number>> {
  const flags = new Map<string, number>();
  const batches: string[][] = [];
  for (let i = 0; i < paths.length; ) {
    let bytes = 0;
    const batch: string[] = [];
    while (i < paths.length && bytes < ARG_BUDGET) {
      bytes += Buffer.byteLength(paths[i]) + 1;
      batch.push(paths[i++]);
    }
    batches.push(batch);
  }
  await Promise.all(
    batches.map(async (batch) => {
      let stdout = "";
      try {
        stdout = (await execFileAsync("/usr/bin/stat", ["-f", "%Xf %N", "--", ...batch], { maxBuffer: 1 << 28 })).stdout;
      } catch (e) {
        // stat exits non-zero if any path vanished; the lines it did print are still valid.
        stdout = (e as { stdout?: string }).stdout ?? "";
      }
      for (const line of stdout.split("\n")) {
        const space = line.indexOf(" ");
        if (space > 0) flags.set(line.slice(space + 1), parseInt(line.slice(0, space), 16));
      }
    }),
  );
  return flags;
}

/** Counting semaphore that serves the lowest `priority` first, newest first among equals (depth-first keeps queues short). */
class Limiter {
  private active = 0;
  private readonly waiting: Array<Array<() => void>> = [];
  private lowest = 0;

  constructor(private readonly max: number) {}

  async run<T>(priority: number, fn: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active++;
    else {
      await new Promise<void>((resolve) => {
        (this.waiting[priority] ??= []).push(resolve);
        if (priority < this.lowest) this.lowest = priority;
      });
    }
    try {
      return await fn();
    } finally {
      const next = this.take();
      if (next) next();
      else this.active--;
    }
  }

  private take(): (() => void) | undefined {
    for (; this.lowest < this.waiting.length; this.lowest++) {
      const next = this.waiting[this.lowest]?.pop();
      if (next) return next;
    }
    this.lowest = 0;
    return undefined;
  }
}

/** One scanned file or directory. `name` is the operand as typed for roots, the entry name below them. */
interface Node {
  name: string;
  entry: Entry;
  flags?: number;
  kids?: Node[];
  fail?: "unreadable" | "cycle";
}

interface Scanned {
  root: Node | null;
  /** Entries below this operand that could not be read, so its numbers are incomplete. */
  unreadable: number;
  /** Where the operand points, when it is itself a symlink that was not followed. */
  linkTarget?: string;
  /** Contains a multiply-linked file, so its numbers can depend on operands before it. */
  linked: boolean;
}

class CycleAbort extends Error {}

const UNIT_BYTES = { k: 1024, m: 1048576, g: 1073741824 } as const;

export async function du(paths: string[], options: Options, io: IO, live?: Live): Promise<number> {
  // du remembers a multiply-linked file only until all its links have been met; after that it is "new" again.
  const seen = new Map<string, number>();
  const limiter = new Limiter(CONCURRENCY);
  let status = 0;
  let scanned = 0;

  const fmt = (blocks: number): string => {
    const bytes = blocks * BLOCK;
    switch (options.unit) {
      case "human": return humanize(bytes, false, options.decimalPoint);
      case "si": return humanize(bytes, true, options.decimalPoint);
      case "blocks": return String(Math.ceil(bytes / options.displayBlock));
      default: return String(Math.ceil(bytes / UNIT_BYTES[options.unit]));
    }
  };

  const warn = (path: string, e: unknown, write: (text: string) => void = io.err): void => {
    write(`icdu: ${path}: ${reason(e)}\n`);
    status = 1;
  };

  /** Size of one entry in 512-byte blocks, honouring -A and -B. */
  const entryBlocks = (e: Entry, dataless: boolean): number => {
    if (!options.apparent && options.blockSize === undefined) return blocksOf(e, dataless);
    let bytes = options.apparent ? e.size : blocksOf(e, dataless) * BLOCK;
    if (options.blockSize !== undefined) bytes = Math.ceil(bytes / options.blockSize) * options.blockSize;
    return Math.ceil(bytes / BLOCK);
  };

  const ignored = (path: string): boolean => {
    if (options.ignore.length === 0) return false;
    const name = basename(path);
    return options.ignore.some((match) => match(name));
  };

  const stat = async (path: string, follow: boolean, priority: number): Promise<Entry> =>
    limiter.run(priority, async () => {
      if (follow) {
        try {
          return toEntry(await fs.promises.stat(path, { bigint: true }));
        } catch {
          /* dangling link: report the link itself */
        }
      }
      return toEntry(await fs.promises.lstat(path, { bigint: true }));
    });

  // Listings must follow du's raw directory order, which only opendir preserves (readdir sorts by name)
  // and which costs about twice as much per directory. Totals-only runs (-s, -d0) are order-independent.
  const readNames = (path: string, priority: number): Promise<string[]> =>
    limiter.run(priority, async () => {
      if (options.depth === 0) return fs.promises.readdir(path);
      const names: string[] = [];
      for await (const e of await fs.promises.opendir(path, { bufferSize: 1024 })) names.push(e.name);
      return names;
    });

  const isDataless = (e: Entry, flags: number | undefined): boolean =>
    // If stat(1) could not tell us (flags undefined), assume evicted: the common case for block-less files.
    !options.local && isCandidate(e) && (flags === undefined || (flags & UF_DATALESS) !== 0);

  const showDir = (blocks: number): boolean => options.threshold === undefined || blocks >= options.threshold;

  // ---- phase 1: scan an operand's tree, with filesystem calls running concurrently ----
  const scanOperand = async (path: string, priority: number): Promise<Scanned> => {
    const result: Scanned = { root: null, linked: false, unreadable: 0 };
    const fail = (path: string, err: unknown, root = false): void => {
      result.unreadable++;
      if (root) warn(path, err);
      else warn(path, err, io.warn ?? io.err);
    };
    const pending: Array<{ node: Node; path: string }> = [];
    let aborted = false;

    const scan = async (
      path: string,
      name: string,
      entry: Entry,
      flags: number | undefined,
      rootDev: bigint,
      chain: Chain | undefined,
    ): Promise<Node | null> => {
      if (ignored(path) || (options.nodump && flags !== undefined && (flags & UF_NODUMP) !== 0)) return null;
      if (++scanned % 1024 === 0) io.tick?.(scanned);
      const node: Node = { name, entry, flags };

      if (!entry.isDir) {
        if (entry.nlink > 1) result.linked = true;
        if (flags === undefined && !options.apparent && !options.local && isCandidate(entry)) pending.push({ node, path });
        return node;
      }
      if (options.xdev && entry.dev !== rootDev) return node;

      const key = `${entry.dev}:${entry.ino}`;
      if (options.follow === "all") {
        for (let c = chain; c; c = c.parent) {
          if (c.key === key) {
            io.err(`icdu: Can't follow symlink cycle from ${path} to ${path}\n`);
            status = 1;
            aborted = true;
            node.fail = "cycle";
            return node;
          }
        }
      }
      let names: string[];
      try {
        names = await readNames(path, priority);
      } catch (err) {
        fail(path, err, chain === undefined);
        node.fail = "unreadable";
        return node;
      }
      const stats = await Promise.all(
        names.map(async (childName) => {
          const child = `${path}/${childName}`;
          try {
            return { name: childName, path: child, entry: await stat(child, options.follow === "all", priority) };
          } catch (err) {
            fail(child, err);
            return null;
          }
        }),
      );
      const children = stats.filter((c): c is NonNullable<typeof c> => c !== null);
      // -n must know the flags before descending; otherwise they are only fetched for candidates, in bulk, later.
      const known = options.nodump && children.length ? await readFlags(children.map((c) => c.path)) : undefined;
      const here: Chain = { key, parent: chain };
      const kids = await Promise.all(
        children.map((c) => (aborted ? null : scan(c.path, c.name, c.entry, known?.get(c.path), rootDev, here))),
      );
      node.kids = kids.filter((k): k is Node => k !== null);
      return node;
    };

    let entry: Entry;
    try {
      entry = await stat(path, options.follow !== "none", priority);
    } catch (err) {
      warn(path, err);
      return result;
    }
    const flags = options.nodump ? (await readFlags([path])).get(path) : undefined;
    if (live && entry.isSymlink) result.linkTarget = await fs.promises.readlink(path).catch(() => undefined);
    result.root = await scan(path, path, entry, flags, entry.dev, undefined);
    if (pending.length) {
      const resolved = await readFlags(pending.map((p) => p.path));
      for (const { node, path } of pending) node.flags = resolved.get(path);
    }
    return result;
  };

  /** True if this link's file was already counted. Mirrors du's link table, which forgets a file once its last link is seen. */
  const repeatedLink = (e: Entry): boolean => {
    const key = `${e.dev}:${e.ino}`;
    const left = seen.get(key);
    if (left === undefined) {
      seen.set(key, e.nlink - 1);
      return false;
    }
    if (left <= 1) seen.delete(key);
    else seen.set(key, left - 1);
    return true;
  };

  // ---- phase 2: print in du's order, counting hard links once ----
  const emit = (node: Node, path: string, level: number, lines: Line[]): number => {
    const e = node.entry;
    if (!e.isDir) {
      if (e.nlink > 1 && !options.allLinks && repeatedLink(e)) return 0;
      const blocks = entryBlocks(e, isDataless(e, node.flags));
      if (options.all || level === 0) lines.push({ text: `${fmt(blocks)}\t${path}`, blocks });
      return blocks;
    }
    if (node.fail === "cycle") throw new CycleAbort();
    if (node.fail === "unreadable") return 0;
    let total = entryBlocks(e, false);
    for (const kid of node.kids ?? []) total += emit(kid, `${path}/${kid.name}`, level + 1, lines);
    if (level <= options.depth && showDir(total)) lines.push({ text: `${fmt(total)}\t${path}`, blocks: total });
    return total;
  };

  const operands = paths.map((path, i) => scanOperand(path, i));
  const rows = paths.length + (options.total ? 1 : 0);
  live?.begin([...paths, ...(options.total ? ["total"] : [])]);

  const noteFor = (scan: Scanned): string | undefined => {
    const notes = [
      scan.linkTarget === undefined ? "" : `${ARROW} ${scan.linkTarget}`,
      scan.unreadable ? `${WARN} ${scan.unreadable} unreadable` : "",
    ].filter(Boolean);
    return notes.length ? notes.join("  ") : undefined;
  };

  const sorting = options.sort !== "none";
  /** Stable, so lines of equal size keep du's order. */
  const bySize = (a: { blocks: number }, b: { blocks: number }): number =>
    options.sort === "asc" ? a.blocks - b.blocks : b.blocks - a.blocks;

  const done: Array<{ total: number; lines: Line[] } | undefined> = [];
  const held: Line[] = []; // with -S, lines are kept back and printed sorted at the end
  const emitOperand = (i: number, scan: Scanned): void => {
    if (done[i]) return;
    const lines: Line[] = [];
    const show = (): void => {
      if (live) live.resolve(i, lines.length ? lines.map((l) => l.text).join("\n") : null, noteFor(scan));
      else if (sorting) held.push(...lines);
      else if (lines.length) io.out(lines.map((l) => l.text).join("\n") + "\n");
    };
    let total = 0;
    try {
      total = scan.root ? emit(scan.root, paths[i], 0, lines) : 0;
    } finally {
      done[i] = { total, lines };
      show(); // on a cycle, du has already printed what came before it
    }
  };

  const flushHeld = (): void => {
    if (held.length) io.out([...held].sort(bySize).map((l) => l.text).join("\n") + "\n");
    held.length = 0;
  };

  /** Final on-screen order of the live rows: settled rows by size, then hidden ones, with the total row last. */
  const liveOrder = (): number[] | undefined => {
    if (!sorting) return undefined;
    const rowsWithLine = paths.map((_, i) => ({ row: i, blocks: done[i]?.lines[0]?.blocks, has: Boolean(done[i]?.lines.length) }));
    const shown = rowsWithLine.filter((r) => r.has).sort((a, b) => bySize({ blocks: a.blocks ?? 0 }, { blocks: b.blocks ?? 0 }));
    const hidden = rowsWithLine.filter((r) => !r.has);
    return [...shown, ...hidden].map((r) => r.row).concat(options.total ? [paths.length] : []);
  };

  // An operand with no multiply-linked files cannot be affected by earlier operands, so a live table may show it at once.
  const early = live !== undefined && options.follow !== "all";
  if (early) {
    operands.forEach((p, i) => void p.then((scan) => (!scan.linked || options.allLinks ? emitOperand(i, scan) : undefined)));
  }

  try {
    for (let i = 0; i < paths.length; i++) emitOperand(i, await operands[i]);
  } catch (err) {
    if (!(err instanceof CycleAbort)) throw err;
    // like du, a symlink cycle ends the whole run: nothing after it is printed, not even the total
    for (let row = 0; row < rows; row++) if (!done[row]) live?.resolve(row, null);
    flushHeld();
    live?.end(liveOrder());
    return status;
  }

  flushHeld();
  if (options.total) {
    const line = `${fmt(done.reduce((sum, d) => sum + (d?.total ?? 0), 0))}\ttotal`;
    if (live) {
      const unreadable = (await Promise.all(operands)).reduce((sum, o) => sum + o.unreadable, 0);
      live.resolve(paths.length, line, unreadable ? `${WARN} ${unreadable} unreadable` : undefined);
    } else io.out(line + "\n");
  }
  live?.end(liveOrder());
  return status;
}

interface Chain {
  key: string;
  parent: Chain | undefined;
}
