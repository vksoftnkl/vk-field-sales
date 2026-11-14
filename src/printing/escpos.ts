/**
 * Minimal ESC/POS command builder for 3-inch (80 mm, 48 columns @ Font A) thermal printers.
 * Produces raw bytes; a transport (Bluetooth Classic SPP) sends them.
 * For 2-inch (58 mm) printers use width 32.
 */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Align = 'left' | 'center' | 'right';

export class EscPos {
  private chunks: number[] = [];
  constructor(public readonly width = 48) {
    this.raw(ESC, 0x40); // initialise
  }

  raw(...bytes: number[]): this {
    this.chunks.push(...bytes);
    return this;
  }

  /** ASCII only. Tamil needs bitmap (raster) printing — render text to an image first. */
  text(s: string): this {
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      this.chunks.push(c < 128 ? c : 0x3f); // '?' for non-ASCII; ₹ → use "Rs."
    }
    return this;
  }

  line(s = ''): this {
    return this.text(s).raw(LF);
  }

  align(a: Align): this {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** 1 = normal, 2 = double width+height. */
  size(n: 1 | 2): this {
    return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00);
  }

  divider(ch = '-'): this {
    return this.line(ch.repeat(this.width));
  }

  /** Left text and right text on one line, e.g. "Total" ... "1,250.00". */
  pair(left: string, right: string): this {
    const space = Math.max(1, this.width - left.length - right.length);
    return this.line(`${left}${' '.repeat(space)}${right}`.slice(0, this.width));
  }

  /** Fixed-width columns; widths should add up to this.width. */
  row(cols: { text: string; width: number; align?: Align }[]): this {
    const out = cols
      .map(({ text, width, align = 'left' }) => {
        const t = text.slice(0, width);
        return align === 'right' ? t.padStart(width) : t.padEnd(width);
      })
      .join('');
    return this.line(out);
  }

  feed(lines = 3): this {
    return this.raw(ESC, 0x64, lines);
  }

  cut(): this {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}
