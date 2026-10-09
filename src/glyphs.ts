/** Terminals without a UTF-8 locale get ASCII stand-ins for the decorative glyphs. */
export const utf8 = /utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "");

export const ARROW = utf8 ? "→" : "->";
export const WARN = utf8 ? "⚠" : "!";
export const SPINNER = utf8 ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["|", "/", "-", "\\"];
