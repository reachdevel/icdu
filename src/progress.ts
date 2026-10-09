/** Scan progress on stderr, shown only on a terminal and only once the scan has taken a noticeable time. */
const DELAY_MS = 500;
const REFRESH_MS = 80;

import { SPINNER as FRAMES } from "./glyphs";
export { FRAMES };

export class Progress {
  private readonly enabled: boolean;
  private readonly started = Date.now();
  private entries = 0;
  private frame = 0;
  private visible = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(allowed: boolean) {
    this.enabled = allowed && process.stderr.isTTY === true && process.env.TERM !== "dumb";
  }

  start(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => this.render(), REFRESH_MS);
    this.timer.unref();
  }

  update(entries: number): void {
    this.entries = entries;
  }

  private render(): void {
    if (Date.now() - this.started < DELAY_MS) return;
    this.visible = true;
    process.stderr.write(`\r\x1b[K${FRAMES[this.frame++ % FRAMES.length]} scanning… ${this.entries.toLocaleString("en-US")} entries`);
  }

  /** Wipe the progress line so ordinary output and warnings start on a clean line. */
  clear(): void {
    if (!this.visible) return;
    this.visible = false;
    process.stderr.write("\r\x1b[K");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.clear();
  }
}
