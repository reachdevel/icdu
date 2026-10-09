import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { humanize } from "../format";

// `du -Ah` on a sparse file of N bytes prints N rounded up to 512, humanized: a cheap oracle for `-h`.
test("humanize matches du -h and du --si", () => {
  const dir = mkdtempSync(join(tmpdir(), "icdu-fmt-"));
  const file = join(dir, "f");
  writeFileSync(file, "");
  try {
    const sizes = new Set<number>([0, 512, 1024, 1536, 9216, 10240, 10752, 1023488, 1024000, 1047552, 1048576]);
    for (let e = 9; e < 45; e++) {
      for (const f of [1, 1.05, 1.5, 1.95, 3.7, 9.4, 9.95, 9.99, 10.4, 10.5, 99.5, 100, 123.4, 999.4, 999.5, 1000, 1023.9]) {
        sizes.add(Math.floor((2 ** (e - 9) * f) / 1) * 512);
      }
    }
    let state = 12345;
    for (let n = 0; n < 150; n++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      sizes.add(Math.floor((state / 2147483648) * 2 ** (10 + (n % 30))) * 512);
    }
    for (const size of [...sizes].filter((s) => s <= 2 ** 52)) {
      truncateSync(file, size);
      const blocks = Math.ceil(size / 512) * 512;
      for (const [flag, si] of [["-h", false], ["--si", true]] as const) {
        const expected = execFileSync("/usr/bin/du", ["-A", flag, file], { encoding: "utf8" }).split("\t")[0];
        assert.equal(humanize(blocks, si), expected, `size ${size} ${flag}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
