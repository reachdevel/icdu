import { decimalPoint } from "./format";
import { fnmatch } from "./glob";

export type Unit = "blocks" | "k" | "m" | "g" | "human" | "si";

export interface Options {
  all: boolean;
  total: boolean;
  /** Deepest level that gets its own output line; `Infinity` means unlimited. */
  depth: number;
  unit: Unit;
  /** Bytes per displayed block when `unit` is "blocks" (from $BLOCKSIZE). */
  displayBlock: number;
  /** -A: report apparent sizes. */
  apparent: boolean;
  /** -B: estimate usage on a filesystem with this block size (bytes), if given. */
  blockSize?: number;
  /** -H / -L / -P */
  follow: "none" | "cmdline" | "all";
  /** -l: count hard links every time. */
  allLinks: boolean;
  /** -x: do not cross mount points. */
  xdev: boolean;
  /** -n: skip entries flagged nodump. */
  nodump: boolean;
  /** -I: ignore entries whose name matches. */
  ignore: Array<(name: string) => boolean>;
  /** Decimal separator for -h / --si, from the locale like du. */
  decimalPoint: string;
  /** --local: count only what is stored on this Mac, exactly like du (evicted iCloud files count as nothing). */
  local: boolean;
  /** --plain: no live table, no progress display; just du-style output. */
  plain: boolean;
  /** -t: directories need at least this many 512-byte blocks to be listed; a negative -t hides every directory, as on macOS. */
  threshold?: number;
}

export type Parsed =
  | { kind: "run"; options: Options; paths: string[]; warnings: string[] }
  | { kind: "usage" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string; usage?: boolean };

const SUFFIX: Record<string, number> = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4, p: 1024 ** 5, e: 1024 ** 6 };

/** Same option grammar as macOS `du`: clustered short flags, valued options, options end at the first operand. */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Parsed {
  const warnings: string[] = [];
  const options: Options = {
    all: false,
    total: false,
    depth: Infinity,
    unit: "blocks",
    displayBlock: blockSizeFromEnv(env.BLOCKSIZE, warnings),
    apparent: false,
    follow: "none",
    allLinks: false,
    xdev: false,
    nodump: false,
    ignore: [],
    decimalPoint: ".",
    local: enabled(env.ICDU_LOCAL),
    plain: enabled(env.ICDU_PLAIN) || enabled(env.CI),
  };
  let sFlag = false;
  let dFlag = false;
  let bytesPerBlock: number | undefined;
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "-" || !arg.startsWith("-")) break;
    if (arg === "--si") {
      options.unit = "si";
      continue;
    }
    if (arg === "--help") return { kind: "help" };
    if (arg === "--version") return { kind: "version" };
    if (arg === "--local" || arg === "--plain") {
      options[arg === "--local" ? "local" : "plain"] = true;
      continue;
    }
    if (arg.startsWith("--")) return { kind: "usage" };
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j];
      if (flag === "d" || flag === "B" || flag === "I" || flag === "t") {
        const value = arg.length > j + 1 ? arg.slice(j + 1) : argv[++i];
        if (value === undefined) return { kind: "usage" };
        const bad = (): Parsed => ({ kind: "error", message: `invalid ${flag === "t" ? "threshold" : `argument to option ${flag}`}: ${value}`, usage: true });
        if (flag === "d") {
          if (/^\s*-\d+/.test(value)) return bad();
          options.depth = Math.max(0, parseInt(value, 10) || 0);
          dFlag = true;
        } else if (flag === "B") {
          const n = parseInt(value, 10);
          if (!(n > 0)) return bad();
          bytesPerBlock = n;
        } else if (flag === "I") {
          options.ignore.push(fnmatch(value));
        } else {
          const t = parseThreshold(value);
          if (t === undefined) return bad();
          options.threshold = t;
        }
        break;
      }
      switch (flag) {
        case "a": options.all = true; break;
        case "c": options.total = true; break;
        case "s": sFlag = true; options.depth = 0; break;
        case "h": options.unit = "human"; break;
        case "k": options.unit = "k"; break;
        case "m": options.unit = "m"; break;
        case "g": options.unit = "g"; break;
        case "A": options.apparent = true; break;
        case "H": options.follow = "cmdline"; break;
        case "L": options.follow = "all"; break;
        case "P": options.follow = "none"; break;
        case "l": options.allLinks = true; break;
        case "x": options.xdev = true; break;
        case "n": options.nodump = true; break;
        case "r": break;
        default: return { kind: "usage" };
      }
    }
  }
  if ([options.all, sFlag, dFlag].filter(Boolean).length > 1) return { kind: "usage" };
  if (options.unit === "human" || options.unit === "si") options.decimalPoint = decimalPoint(env);
  if (bytesPerBlock !== undefined) {
    options.blockSize = options.apparent ? bytesPerBlock : Math.ceil(bytesPerBlock / 512) * 512;
  }
  const paths = argv.slice(i);
  return { kind: "run", options, paths: paths.length ? paths : ["."], warnings };
}

/** Environment switches: set and not an obvious "no". */
function enabled(value: string | undefined): boolean {
  return value !== undefined && value !== "" && !/^(0|false|no|off)$/i.test(value);
}

/** macOS `du -t`: a positive size with optional K/M/G/... suffix, or a bare negative number. Stored in 512-byte blocks. */
function parseThreshold(value: string): number | undefined {
  const m = /^(-?)(\d+)([kmgtpe]?)$/i.exec(value);
  if (!m) return undefined;
  const [, sign, digits, suffix] = m;
  if (sign && suffix) return undefined;
  const bytes = Number(digits) * (suffix ? SUFFIX[suffix.toLowerCase()] : 1);
  if (bytes === 0) return undefined;
  return sign ? Infinity : Math.floor(bytes / 512);
}

/** getbsize(3) semantics for $BLOCKSIZE. */
function blockSizeFromEnv(raw: string | undefined, warnings: string[]): number {
  if (!raw) return 512;
  const m = /^\s*([-+]?\d*)([kmg]?)(.*)$/i.exec(raw)!;
  if (m[3] !== "") {
    warnings.push(`${raw}: unknown blocksize`);
    return 512;
  }
  let n = m[1] === "" || m[1] === "-" || m[1] === "+" ? 1 : parseInt(m[1], 10);
  if (m[2]) n *= SUFFIX[m[2].toLowerCase()];
  if (n < 512) {
    warnings.push("minimum blocksize is 512");
    return 512;
  }
  if (n > 1024 ** 3) {
    warnings.push("maximum blocksize is 1G");
    return 1024 ** 3;
  }
  return Math.floor(n / 512) * 512;
}
