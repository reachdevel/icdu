import type { Live } from "./du";
import { FRAMES } from "./progress";

interface Row {
  label: string;
  state: "pending" | "done" | "hidden";
  text: string;
  note?: string;
}

const REFRESH_MS = 80;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DIM = "\x1b[2m";
const NORMAL = "\x1b[22m";

/** Terminal columns taken by a line, with tabs expanding to the next multiple of 8. */
function width(line: string): number {
  let w = 0;
  for (const ch of line) w = ch === "\t" ? w + 8 - (w % 8) : w + 1;
  return w;
}

/**
 * One terminal line per operand, in output order. Pending rows spin; a row is rewritten in place when its
 * value arrives, so quick operands appear without waiting for slow ones before them. Once every row has
 * settled the screen holds exactly the text `du` would have printed.
 */
export class LiveTable implements Live {
  private rows: Row[] = [];
  private drawn = 0;
  private frame = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly onSigint = (): void => {
    this.stopTimer();
    process.stdout.write(SHOW_CURSOR);
    process.exit(130);
  };

  constructor(private readonly out: NodeJS.WriteStream) {}

  begin(labels: string[]): void {
    this.rows = labels.map((label) => ({ label, state: "pending", text: "" }));
    this.out.write(HIDE_CURSOR);
    process.once("SIGINT", this.onSigint);
    this.draw();
    this.timer = setInterval(() => {
      this.frame++;
      this.draw();
    }, REFRESH_MS);
  }

  resolve(row: number, text: string | null, note?: string): void {
    this.rows[row] = text === null ? { ...this.rows[row], state: "hidden" } : { ...this.rows[row], state: "done", text, note };
    this.draw();
  }

  end(order?: number[]): void {
    if (order) this.rows = order.map((i) => this.rows[i]);
    this.stopTimer();
    this.draw();
    this.out.write(SHOW_CURSOR);
    process.removeListener("SIGINT", this.onSigint);
  }

  /** Print a message (e.g. a warning) above the table without corrupting it. */
  interject(write: () => void): void {
    this.out.write(this.drawn ? `\x1b[${this.drawn}A\r\x1b[J` : "");
    this.drawn = 0;
    write();
    this.draw();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private draw(): void {
    const columns = this.out.columns || 80;
    const spinner = FRAMES[this.frame % FRAMES.length].padStart(4);
    let buf = this.drawn ? `\x1b[${this.drawn}A` : "";
    buf += "\r";
    let physical = 0;
    for (const row of this.rows) {
      if (row.state === "hidden") continue;
      const line = row.state === "pending" ? `${spinner}\t${row.label}` : row.text;
      const note = row.state === "done" && row.note ? `   ${row.note}` : "";
      buf += `\x1b[K${line}${note ? DIM + note + NORMAL : ""}\n`;
      physical += Math.max(1, Math.ceil(width(line + note) / columns));
    }
    buf += "\x1b[J";
    this.drawn = physical;
    this.out.write(buf);
  }
}
