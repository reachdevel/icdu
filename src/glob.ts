/** Compile an fnmatch(3) pattern (flags = 0) into a matcher. */
export function fnmatch(pattern: string): (name: string) => boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "\\" && i + 1 < pattern.length) re += escape(pattern[++i]);
    else if (c === "[") {
      const end = closingBracket(pattern, i);
      if (end < 0) {
        re += "\\[";
        continue;
      }
      let body = pattern.slice(i + 1, end);
      let negate = false;
      if (body[0] === "!" || body[0] === "^") {
        negate = true;
        body = body.slice(1);
      }
      re += `[${negate ? "^" : ""}${body.replace(/[\\\]^]/g, "\\$&")}]`;
      i = end;
    } else re += escape(c);
  }
  const compiled = new RegExp(`^${re}$`, "s");
  return (name) => compiled.test(name);
}

function closingBracket(pattern: string, open: number): number {
  let i = open + 1;
  if (pattern[i] === "!" || pattern[i] === "^") i++;
  if (pattern[i] === "]") i++;
  while (i < pattern.length && pattern[i] !== "]") i++;
  return i < pattern.length ? i : -1;
}

function escape(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
