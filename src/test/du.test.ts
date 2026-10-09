import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { du } from "../du";
import { ARROW, WARN } from "../glyphs";
import { parseArgs } from "../options";

async function icdu(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ out: string; err: string; code: number }> {
  const parsed = parseArgs(args, env);
  if (parsed.kind === "help" || parsed.kind === "version") throw new Error("not a du invocation");
  if (parsed.kind === "usage") return { out: "", err: "usage: icdu\n", code: 64 };
  if (parsed.kind === "error") return { out: "", err: `icdu: ${parsed.message}\nusage: icdu\n`, code: 64 };
  const cwdBefore = process.cwd();
  process.chdir(cwd);
  try {
    let out = "";
    let err = "";
    for (const w of parsed.warnings) err += `icdu: ${w}\n`;
    const code = await du(parsed.paths, parsed.options, { out: (s) => (out += s), err: (s) => (err += s) });
    return { out, err, code };
  } finally {
    process.chdir(cwdBefore);
  }
}

function realDu(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { out: string; err: string; code: number } {
  const r = spawnSync("/usr/bin/du", args.filter((a) => a !== "--local" && a !== "--plain"), { cwd, encoding: "utf8", maxBuffer: 1 << 28, env: { PATH: process.env.PATH, ...env } });
  return { out: r.stdout, err: r.stderr.replaceAll("du:", "icdu:"), code: r.status ?? -1 };
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "icdu-"));
  mkdirSync(join(root, "a/b"), { recursive: true });
  mkdirSync(join(root, "c"));
  mkdirSync(join(root, "empty"));
  mkdirSync(join(root, "locked"));
  writeFileSync(join(root, "top"), "x".repeat(10));
  writeFileSync(join(root, "big"), "y".repeat(3_000_000));
  writeFileSync(join(root, "a/f1"), "hello");
  writeFileSync(join(root, "a/b/f2"), "z".repeat(5000));
  linkSync(join(root, "a/f1"), join(root, "c/hard"));
  symlinkSync("../a", join(root, "c/sym"));
  mkdirSync(join(root, "d/sub"), { recursive: true });
  writeFileSync(join(root, "d/f"), "abc\n");
  writeFileSync(join(root, "d/big"), "y".repeat(100_000));
  writeFileSync(join(root, "d/sub/g"), "x".repeat(5000));
  linkSync(join(root, "d/f"), join(root, "d/f2"));
  symlinkSync("sub", join(root, "d/sl"));
  symlinkSync("d", join(root, "lnk"));
  symlinkSync("d/big", join(root, "flink"));
  symlinkSync("nothing", join(root, "broken"));
  mkdirSync(join(root, "ig/keep"), { recursive: true });
  mkdirSync(join(root, "ig/skipdir"));
  writeFileSync(join(root, "ig/keep/a.txt"), "a");
  writeFileSync(join(root, "ig/keep/d.log"), "d");
  writeFileSync(join(root, "ig/b.log"), "b");
  writeFileSync(join(root, "ig/skipdir/c.txt"), "c");
  execFileSync("/usr/bin/chflags", ["nodump", join(root, "ig/b.log"), join(root, "ig/skipdir")]);
  // fully sparse: no blocks, real size, but not evicted from iCloud
  mkdirSync(join(root, "sparse"));
  writeFileSync(join(root, "sparse/hole"), "");
  truncateSync(join(root, "sparse/hole"), 10_000_000);
  mkdirSync(join(root, "cy/x"), { recursive: true });
  symlinkSync("..", join(root, "cy/x/up"));
  symlinkSync("nothing", join(root, "cy/broken"));
  mkdirSync(join(root, "cy2"));
  writeFileSync(join(root, "cy2/f"), "hi");
  chmodSync(join(root, "locked"), 0o000);
  return root;
}

type Result = { out: string; err: string; code: number };

function compare(mine: Result, real: Result, args: string[]): void {
  const label = `du ${args.join(" ")}`;
  assert.equal(mine.out, real.out, `stdout for ${label}`);
  assert.equal(mine.code, real.code, `exit code for ${label}`);
  // Option errors differ only by the usage banner, which names the program.
  const norm = (e: string) => e.split("\n").filter((l) => l && !l.startsWith("usage:") && !l.startsWith("            [")).sort();
  assert.deepEqual(norm(mine.err), norm(real.err), `stderr for ${label}`);
}

const CASES = [
  [],
  ["-a"],
  ["-h"],
  ["-sh"],
  ["-shc", "a", "c", "top", "big"],
  ["-d1"],
  ["-d", "2", "-h"],
  ["-d0", "a"],
  ["-k", "a"],
  ["-m", "big"],
  ["-g", "big"],
  ["-hk", "big"],
  ["-kh", "big"],
  ["-c", "a", "a"],
  ["-s", "nonexistent", "top"],
  ["a/"],
  ["c/sym"],
  ["-ah", "a"],
  ["-cs"],
  ["-A", "d"],
  ["-Aa", "d"],
  ["-Ak", "d"],
  ["-Ah", "d"],
  ["-Ac", "d", "top", "big"],
  ["-l", "-a", "d"],
  ["-lc", "d/f", "d/f2"],
  ["-H", "lnk"],
  ["-Ha", "lnk"],
  ["-L", "-a", "d"],
  ["-La", "flink", "lnk", "broken"],
  ["-P", "-a", "lnk"],
  ["-Ha", "flink"],
  ["--si", "big"],
  ["--si", "-c", "d", "big"],
  ["-h", "--si", "big"],
  ["--si", "-h", "big"],
  ["-ah", "--si", "d"],
  ["-B", "8192", "-a", "d"],
  ["-B", "4096", "-A", "-a", "d"],
  ["-B", "1000", "d"],
  ["-B1M", "d"],
  ["-B", "0", "d"],
  ["-B", "abc", "d"],
  ["-a", "-I", "*.log", "ig"],
  ["-a", "-I", "skipdir", "ig"],
  ["-a", "-I", "*.log", "-I", "keep", "ig"],
  ["-a", "-I", "ig", "ig"],
  ["-a", "-I", "*/keep", "ig"],
  ["-I", "k*", "ig/keep"],
  ["-a", "-I", "[a-c].*", "ig"],
  ["-a", "-I", "?.log", "ig"],
  ["-an", "ig"],
  ["-n", "-c", "ig", "ig/b.log"],
  ["-t", "100k", "-a", "d"],
  ["-t8192", "d"],
  ["-t", "8703", "d"],
  ["-t", "8704", "d"],
  ["-t", "1", "-a", "d"],
  ["-t", "-1", "-a", "d"],
  ["-t", "-100000", "d"],
  ["-t", "5M", "d"],
  ["-t", "1g", "d"],
  ["-t", "0", "d"],
  ["-t", "-1k", "d"],
  ["-t", "abc", "d"],
  ["-t", "1 k", "d"],
  ["-kt", "8k", "d"],
  ["-r", "top"],
  ["--plain", "-sh", "d", "top"],
  ["--local", "-a", "d"],
  ["-s", "d", "d"],
  ["-s", "d", "d", "d"],
  ["-s", "a", "a", "a"],
  ["-s", "d/f", "d/f2"],
  ["-s", "d/f", "d/f", "d/f"],
  ["-sc", "d", "lnk", "d"],
  ["-sH", "lnk", "d"],
  ["-a", "d", "d"],
  ["-a", "sparse"],
  ["-sh", "sparse"],
  ["-Aa", "sparse"],
  ["-L", "cy"],
  ["-La", "cy"],
  ["-La", "cy/x", "top"],
  ["-L", "cy/x/up", "top"],
  ["-Lc", "cy2", "cy", "cy2"],
  ["-x", "-a", "d"],
  ["-lAx", "-d1", "d"],
  ["-H", "-L", "-P", "-a", "lnk"],
  ["-P", "-H", "-a", "lnk"],
];

const ENV_CASES: Array<[Record<string, string>, string[]]> = [
  [{ BLOCKSIZE: "1k" }, ["d"]],
  [{ BLOCKSIZE: "1M" }, ["d"]],
  [{ BLOCKSIZE: "4096" }, ["d"]],
  [{ BLOCKSIZE: "k" }, ["-s", "d"]],
  [{ BLOCKSIZE: "600" }, ["-s", "d"]],
  [{ BLOCKSIZE: "1000" }, ["-s", "d"]],
  [{ BLOCKSIZE: "1" }, ["-s", "d"]],
  [{ BLOCKSIZE: "-5" }, ["-s", "d"]],
  [{ BLOCKSIZE: "abc" }, ["-s", "d"]],
  [{ BLOCKSIZE: "1kk" }, ["-s", "d"]],
  [{ BLOCKSIZE: "2g" }, ["-s", "d"]],
  [{ BLOCKSIZE: "" }, ["-s", "d"]],
  [{ BLOCKSIZE: "4096" }, ["-k", "-s", "d"]],
  [{ BLOCKSIZE: "4096" }, ["-h", "-s", "d"]],
  [{ LC_ALL: "tr_TR.UTF-8" }, ["-sh", "d", "top"]],
  [{ LC_ALL: "de_DE.UTF-8" }, ["--si", "-c", "d", "top"]],
  [{ LANG: "fr_FR.UTF-8" }, ["-ah", "d"]],
  [{ LC_ALL: "C", LANG: "tr_TR.UTF-8" }, ["-sh", "d"]],
];

test("output matches /usr/bin/du on ordinary (non-iCloud) trees", async () => {
  const root = fixture();
  try {
    for (const args of CASES) {
      const mine = await icdu(args, root);
      const real = realDu(args, root);
      compare(mine, real, args);
    }
    for (const [env, args] of ENV_CASES) {
      compare(await icdu(args, root, env), realDu(args, root, env), [JSON.stringify(env), ...args]);
    }
  } finally {
    chmodSync(join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("--plain and --local, from flags and environment", () => {
  const options = (args: string[], env: NodeJS.ProcessEnv = {}) => {
    const parsed = parseArgs(args, env);
    assert.equal(parsed.kind, "run");
    return parsed.kind === "run" ? parsed.options : (undefined as never);
  };
  assert.deepEqual([options([]).plain, options([]).local], [false, false]);
  assert.deepEqual([options(["--plain"]).plain, options(["--local"]).local], [true, true]);
  assert.equal(options(["-s", "--plain", "x"]).plain, true);
  assert.equal(options([], { ICDU_PLAIN: "1" }).plain, true);
  assert.equal(options([], { CI: "true" }).plain, true);
  assert.equal(options([], { ICDU_PLAIN: "0" }).plain, false);
  assert.equal(options([], { CI: "false" }).plain, false);
  assert.equal(options([], { ICDU_LOCAL: "1" }).local, true);
  assert.equal(options([], { ICDU_LOCAL: "" }).local, false);
  assert.equal(parseArgs(["--bogus"]).kind, "usage");
  const sort = (args: string[]) => {
    const parsed = parseArgs(args, {});
    return parsed.kind === "run" ? parsed.options.sort : parsed.kind;
  };
  assert.deepEqual([sort(["-S"]), sort(["-Sr"]), sort(["-rS"]), sort(["-r"]), sort([])], ["desc", "asc", "asc", "none", "none"]);
});

test("--help and --version", () => {
  assert.equal(parseArgs(["--help"]).kind, "help");
  assert.equal(parseArgs(["-s", "--version"]).kind, "version");
  const version = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")).version;
  const cli = join(__dirname, "../cli.js");
  const v = spawnSync("node", [cli, "--version"], { encoding: "utf8" });
  assert.deepEqual([v.status, v.stdout], [0, `icdu ${version}\n`]);
  const h = spawnSync("node", [cli, "--help"], { encoding: "utf8" });
  assert.equal(h.status, 0);
  assert.match(h.stdout, /^icdu - du for macOS/);
  assert.match(h.stdout, /--local/);
  assert.match(h.stdout, /--plain/);
  const bad = spawnSync("node", [cli, "--bogus"], { encoding: "utf8" });
  assert.deepEqual([bad.status, bad.stdout], [64, ""]);
  assert.match(bad.stderr, /^usage: icdu/);
});

test("option errors", () => {
  assert.equal(parseArgs(["-a", "-s"]).kind, "usage");
  assert.equal(parseArgs(["-s", "-d1"]).kind, "usage");
  assert.equal(parseArgs(["-q"]).kind, "usage");
  assert.equal(parseArgs(["-d"]).kind, "usage");
  assert.equal(parseArgs(["-d", "-1"]).kind, "error");
  assert.deepEqual(parseArgs(["file", "-s"]).kind === "run" && (parseArgs(["file", "-s"]) as { paths: string[] }).paths, ["file", "-s"]);
});

// Evicted iCloud files must be counted as if they were on disk. The oracle is the real
// UF_DATALESS flag read through stat(1), independent of the size/blocks heuristic in the code.
test("evicted iCloud files are counted as on-disk", async (t) => {
  const home = process.env.HOME ?? "";
  const roots = [join(home, "Documents"), join(home, "Desktop")];
  let target: string | undefined;
  for (const root of roots) {
    const r = spawnSync("/bin/ls", ["-lRO", root], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 0) continue;
    let current = root;
    for (const line of r.stdout.split("\n")) {
      if (line.endsWith(":") && line.startsWith("/")) current = line.slice(0, -1);
      else if (line.includes("dataless") && line.startsWith("-")) {
        target = current;
        break;
      }
    }
    if (target) break;
  }
  if (!target) {
    t.skip("no evicted iCloud files under ~/Documents or ~/Desktop");
    return;
  }

  const files = execFileSync("/usr/bin/find", [target, "-type", "f", "-links", "1"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter(Boolean);
  let extra = 0;
  for (let i = 0; i < files.length; i += 1000) {
    const rows = execFileSync("/usr/bin/stat", ["-f", "%Xf\t%z", ...files.slice(i, i + 1000)], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const row of rows) {
      const [flags, size] = row.split("\t");
      if (parseInt(flags, 16) & 0x40000000) extra += (Math.ceil(Number(size) / 4096) * 4096) / 512;
    }
  }
  assert.ok(extra > 0);
  const base = Number(realDu(["-s", target], "/").out.split("\t")[0]);
  const mine = Number((await icdu(["-s", target], "/")).out.split("\t")[0]);
  assert.equal(mine, base + extra);
  // Apparent sizes never depend on what is stored locally, so -A must agree with the real du.
  compare(await icdu(["-A", target], "/"), realDu(["-A", target], "/"), ["-A", target]);
});

test("-x stays on the filesystem of each operand", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "icdu-mnt-"));
  const mountPoint = join(root, "top/inner");
  const dmg = join(root, "x.dmg");
  mkdirSync(mountPoint, { recursive: true });
  writeFileSync(join(root, "top/f"), "hi");
  const attach = () => {
    execFileSync("/usr/bin/hdiutil", ["create", "-quiet", "-size", "10m", "-fs", "APFS", "-volname", "icdutest", dmg]);
    execFileSync("/usr/bin/hdiutil", ["attach", "-quiet", "-nobrowse", "-mountpoint", mountPoint, dmg]);
  };
  try {
    try {
      attach();
    } catch {
      t.skip("cannot mount a disk image here");
      return;
    }
    writeFileSync(join(mountPoint, "in.txt"), "hello");
    for (const args of [["-a", "top"], ["-ax", "top"], ["-ax", "top/inner"], ["-x", "top", "top/inner/in.txt"], ["-sx", "top"]]) {
      compare(await icdu(args, root), realDu(args, root), args);
    }
  } finally {
    spawnSync("/usr/bin/hdiutil", ["detach", "-quiet", "-force", mountPoint]);
    rmSync(root, { recursive: true, force: true });
  }
});

// Inode numbers on the sealed system volume exceed 2^53; identity must survive that (regression: false symlink cycles).
test("system trees with huge inode numbers match du", async () => {
  for (const args of [["-s", "/usr/bin"], ["-sL", "/usr/bin"], ["-a", "/usr/share/man/man1"], ["-ch", "/usr/lib", "/usr/libexec"]]) {
    compare(await icdu(args, "/"), realDu(args, "/"), args);
  }
});

// The live table settles rows in whatever order they finish; read top to bottom it must equal what du prints.
test("live table rows add up to du's output", async () => {
  const root = fixture();
  const cases = [
    ["-s", "a", "c"],
    ["-s", "c", "a"],
    ["-sc", "a", "c", "top", "big", "nonexistent", "empty"],
    ["-shc", "d", "lnk", "ig", "top"],
    ["-sH", "lnk", "d"],
    ["-s", "lnk", "a"],
    ["-sc", "locked", "a"],
    ["-s", "-I", "top", "top", "a"],
    ["-d0", "locked", "a"],
    ["-sL", "cy2", "cy", "cy2"],
    ["-s", "sparse", "top", "-x"],
  ];
  const cwdBefore = process.cwd();
  process.chdir(root);
  try {
    for (const args of cases) {
      const parsed = parseArgs(args, {});
      if (parsed.kind !== "run") continue;
      const rows: Array<string | null | undefined> = [];
      const notes: Record<number, string> = {};
      const live = {
        begin: (labels: string[]) => labels.forEach((_, i) => (rows[i] = undefined)),
        resolve: (row: number, text: string | null, note?: string) => {
          rows[row] = text;
          if (note) notes[row] = note;
        },
        end: () => {},
      };
      let leaked = "";
      await du(parsed.paths, parsed.options, { out: (s) => (leaked += s), err: () => {} }, live);
      assert.equal(leaked, "", "a live display must not also stream to stdout");
      const text = rows.filter((r): r is string => typeof r === "string").map((r) => r + "\n").join("");
      const real = realDu(args, root);
      assert.equal(text, real.out, `live rows for du ${args.join(" ")}`);
      assert.ok(rows.every((r) => r !== undefined), "every row settles");
      if (args.join(" ") === "-s lnk a") assert.deepEqual(notes, { 0: `${ARROW} d` });
      if (args.join(" ") === "-sc locked a") assert.deepEqual(notes, { 0: `${WARN} 1 unreadable`, 2: `${WARN} 1 unreadable` });
    }
  } finally {
    process.chdir(cwdBefore);
    chmodSync(join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

// With --local the evicted-file correction is off, so icdu has to be indistinguishable from du, iCloud or not.
test("--local matches du on iCloud trees", async (t) => {
  const dir = join(process.env.HOME ?? "", "Documents");
  if (spawnSync("/bin/ls", [dir]).status !== 0) return t.skip("no ~/Documents");
  for (const args of [["-sh", dir], ["-a", dir]]) {
    const mine = await icdu(["--local", ...args], "/");
    const real = realDu(args, "/");
    assert.equal(mine.out, real.out, `du ${args.join(" ")}`);
  }
});

test("read errors below an operand go to warn (when provided), errors on the operand itself to err", async () => {
  const root = fixture();
  const cwdBefore = process.cwd();
  process.chdir(root);
  try {
    const run = async (args: string[]) => {
      const parsed = parseArgs(args, {});
      assert.equal(parsed.kind, "run");
      if (parsed.kind !== "run") throw new Error("unreachable");
      const got = { err: "", warn: "" };
      const code = await du(parsed.paths, parsed.options, { out: () => {}, err: (s) => (got.err += s), warn: (s) => (got.warn += s) });
      return { ...got, code };
    };
    const below = await run(["-s", "."]);
    assert.deepEqual([below.err, below.warn, below.code], ["", "icdu: ./locked: Permission denied\n", 1]);
    const operand = await run(["-s", "locked", "nonexistent"]);
    assert.equal(operand.warn, "");
    assert.match(operand.err, /locked: Permission denied/);
    assert.match(operand.err, /nonexistent: No such file or directory/);
  } finally {
    process.chdir(cwdBefore);
    chmodSync(join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

// -S sorts the lines by size, largest first (-r: smallest first); equal sizes keep du's order and the total stays last.
test("-S sorts like `du | sort` would", async () => {
  const root = fixture();
  const cases = [
    ["-d1", "d"],
    ["-a", "d"],
    ["-d1", "-c", "d", "a"],
    ["-sc", "a", "c", "top", "big", "d"],
    ["-s", "d", "top", "big", "a", "c", "empty"],
  ];
  try {
    for (const args of cases) {
      const real = realDu(args, root).out.split("\n").filter(Boolean);
      const size = (line: string) => Number(line.split("\t")[0]);
      const body = real.filter((l) => !l.endsWith("\ttotal"));
      const total = real.filter((l) => l.endsWith("\ttotal"));
      const desc = [...body].sort((a, b) => size(b) - size(a)).concat(total);
      const asc = [...body].sort((a, b) => size(a) - size(b)).concat(total);
      for (const [flags, expected] of [["S", desc], ["Sr", asc], ["rS", asc]] as const) {
        const mine = await icdu([`-${flags}`, ...args], root);
        assert.equal(mine.out, expected.join("\n") + "\n", `-${flags} ${args.join(" ")}`);
      }
      // -h prints different text but must keep the same order
      const humanOrder = (await icdu(["-Sh", ...args], root)).out.split("\n").filter(Boolean).map((l) => l.split("\t")[1]);
      assert.deepEqual(humanOrder, desc.map((l) => l.split("\t")[1]), `-Sh ${args.join(" ")}`);
      // without -S nothing changes, and -r alone stays a no-op
      assert.equal((await icdu(["-r", ...args], root)).out, real.join("\n") + "\n");
    }
  } finally {
    chmodSync(join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("-S reorders the live table rows, total last", async () => {
  const root = fixture();
  const cwdBefore = process.cwd();
  process.chdir(root);
  try {
    for (const [args, expected] of [
      [["-sS", "top", "big", "a", "empty"], ["big", "a", "top", "empty"]],
      [["-sSr", "top", "big", "a", "empty"], ["empty", "top", "a", "big"]],
      [["-scS", "top", "big", "a"], ["big", "a", "top", "total"]],
    ] as const) {
      const parsed = parseArgs([...args], {});
      assert.equal(parsed.kind, "run");
      if (parsed.kind !== "run") continue;
      const labels: string[] = [];
      let order: number[] | undefined;
      const live = {
        begin: (l: string[]) => void labels.push(...l),
        resolve: () => {},
        end: (o?: number[]) => void (order = o),
      };
      await du(parsed.paths, parsed.options, { out: () => {}, err: () => {} }, live);
      assert.deepEqual(order?.map((i) => labels[i]), [...expected], args.join(" "));
    }
  } finally {
    process.chdir(cwdBefore);
    chmodSync(join(root, "locked"), 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});
