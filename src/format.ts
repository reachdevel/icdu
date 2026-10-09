const UNITS_1024 = ["B", "K", "M", "G", "T", "P", "E"];
const UNITS_SI = ["B", "k", "M", "G", "T", "P", "E"];

/**
 * Mirrors macOS `du -h` (base 1024) and `du --si` (base 1000): right-aligned to 4 columns,
 * one decimal below 10, rounds half up, and moves to the next unit when rounding reaches 1000.
 */
export function humanize(bytes: number, si = false): string {
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
    if (tenths < 100n) return `${tenths / 10n}.${tenths % 10n}${units[i]}`.padStart(4);
    const whole = (b + divisor / 2n) / divisor;
    if (whole < 1000n || i === units.length - 1) return `${whole}${units[i]}`.padStart(4);
  }
  /* c8 ignore next */
  return `${b}B`;
}
