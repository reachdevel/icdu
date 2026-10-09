import { execFileSync } from "node:child_process";

const UNITS_1024 = ["B", "K", "M", "G", "T", "P", "E"];
const UNITS_SI = ["B", "k", "M", "G", "T", "P", "E"];

/**
 * The decimal separator `du -h` prints: the C library's `decimal_point` for the locale in `env`
 * (LC_ALL, then LC_NUMERIC, then LANG), e.g. "," under tr_TR or de_DE.
 */
export function decimalPoint(env: NodeJS.ProcessEnv): string {
  const locale = env.LC_ALL || env.LC_NUMERIC || env.LANG || "";
  if (locale === "" || /^(C|POSIX|en_US|en_GB)(\.|$)/.test(locale)) return ".";
  try {
    const out = execFileSync("/usr/bin/locale", ["-k", "decimal_point"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /decimal_point="(.*)"/.exec(out)?.[1] || ".";
  } catch {
    return ".";
  }
}

/**
 * Mirrors macOS `du -h` (base 1024) and `du --si` (base 1000): right-aligned to 4 columns,
 * one decimal below 10, rounds half up, and moves to the next unit when rounding reaches 1000.
 */
export function humanize(bytes: number, si = false, point = "."): string {
  const units = si ? UNITS_SI : UNITS_1024;
  const base = si ? 1000n : 1024n;
  const b = BigInt(bytes);
  let divisor = 1n;
  for (let i = 0; i < units.length; i++, divisor *= base) {
    if (i === 0) {
      if (b < 1000n) return `${b}B`.padStart(4);
      continue;
    }
    const tenths = (b * 10n + divisor / 2n) / divisor;
    if (tenths < 100n) return `${tenths / 10n}${point}${tenths % 10n}${units[i]}`.padStart(4);
    const whole = (b + divisor / 2n) / divisor;
    if (whole < 1000n || i === units.length - 1) return `${whole}${units[i]}`.padStart(4);
  }
  /* c8 ignore next */
  return `${b}B`;
}
