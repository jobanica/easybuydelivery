/**
 * ESC/POS: the command language every cheap thermal receipt printer speaks.
 *
 * A 58mm printer is a roll of paper and a dot line. It has no notion of a page,
 * a font size in points, or a character it hasn't been told about — you hand it
 * bytes, and it prints them. So this module is byte-building and nothing else:
 * no Bluetooth, no DOM, no clue what a receipt is. That keeps it testable,
 * which matters, because the failure mode of a printer is a metre of garbage.
 *
 * Two things are easy to get wrong and are handled here.
 *
 * Width is in characters, not pixels. A 58mm roll fits 32 columns in Font A and
 * an 80mm roll fits 48, so anything that lines a price up against a name has to
 * know which roll it is printing on.
 *
 * Encoding is not UTF-8. These printers default to code page 437, where a
 * peso sign does not exist — send it and you get a random glyph or nothing. So
 * text is folded down to what the printer can actually render, deliberately and
 * in one place, rather than surprising someone at the counter.
 */

const ESC = 0x1b;
const GS = 0x1d;

export type Align = 'left' | 'center' | 'right';

/** Characters a code-page-437 printer can render, beyond plain ASCII. */
const CP437_EXTRA: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86,
  'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d,
  'Ä': 0x8e, 'Å': 0x8f, 'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94,
  'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5,
  '°': 0xf8, '·': 0xfa, '±': 0xf1, '½': 0xab, '¼': 0xac,
};

/**
 * What to print instead of characters the printer has no glyph for.
 *
 * The peso sign is the one that matters: it is the single most common character
 * on a Philippine receipt and code page 437 has never heard of it. "P" is what
 * every receipt printer in the country ends up showing, so it is what we send,
 * rather than leaving the customer to guess at a black lozenge.
 */
const FOLD: Record<string, string> = {
  '₱': 'P', '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-',
  '…': '...', '•': '*', '₽': 'P', '€': 'EUR', '£': 'GBP',
};

/** Fold one string down to bytes the printer can render. */
export function encodeText(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const folded = FOLD[ch];
    if (folded !== undefined) {
      for (const f of folded) out.push(f.charCodeAt(0));
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code < 0x80) { out.push(code); continue; }
    const cp437 = CP437_EXTRA[ch];
    // Anything still unknown becomes '?' — visible, and obviously not a price.
    out.push(cp437 ?? 0x3f);
  }
  return Uint8Array.from(out);
}

/** How many columns a string will occupy once folded. */
export function printedWidth(s: string): number {
  let n = 0;
  for (const ch of s) n += (FOLD[ch] ?? ch).length;
  return n;
}

/**
 * Builds one print job.
 *
 * Deliberately mutable and chainable: a receipt is a sequence of instructions
 * read top to bottom, and writing it that way keeps the layout code looking
 * like the paper that comes out.
 */
export class EscPos {
  private parts: Uint8Array[] = [];
  /** Columns on this roll. 32 fits a 58mm printer, 48 an 80mm one. */
  readonly width: number;

  constructor(width = 32) { this.width = width; }

  private raw(...bytes: number[]): this {
    this.parts.push(Uint8Array.from(bytes));
    return this;
  }

  /** Reset the printer: clears any half-finished state from a failed job. */
  init(): this { return this.raw(ESC, 0x40).codePage437(); }

  /** Say which code page we are sending, rather than trusting the default. */
  codePage437(): this { return this.raw(ESC, 0x74, 0x00); }

  align(a: Align): this {
    return this.raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0);
  }

  bold(on: boolean): this { return this.raw(ESC, 0x45, on ? 1 : 0); }

  /** Double height and width — for a shop name or a total. */
  big(on: boolean): this { return this.raw(GS, 0x21, on ? 0x11 : 0x00); }

  /** Double height only: taller without eating the line width. */
  tall(on: boolean): this { return this.raw(GS, 0x21, on ? 0x01 : 0x00); }

  underline(on: boolean): this { return this.raw(ESC, 0x2d, on ? 1 : 0); }

  /** One line of text, wrapped to the roll width. */
  line(text = ''): this {
    for (const row of wrap(text, this.width)) {
      this.parts.push(encodeText(row));
      this.raw(0x0a);
    }
    if (text === '') this.raw(0x0a);
    return this;
  }

  /**
   * A label on the left and a value hard against the right edge.
   *
   * The whole point of a receipt is that the numbers line up, so when the two
   * cannot fit on one row the label wraps and the value keeps its column
   * rather than being pushed off the paper.
   */
  row(label: string, value: string): this {
    const vw = printedWidth(value);
    const room = this.width - vw - 1;
    if (room <= 0) return this.line(label).line(padStart(value, this.width));

    const rows = wrap(label, room);
    rows.forEach((r, i) => {
      if (i < rows.length - 1) { this.line(r); return; }
      const gap = this.width - printedWidth(r) - vw;
      this.parts.push(encodeText(r + ' '.repeat(Math.max(1, gap)) + value));
      this.raw(0x0a);
    });
    return this;
  }

  /** A full-width rule, for separating the bill from the totals. */
  rule(ch = '-'): this { return this.line(ch.repeat(this.width)); }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i++) this.raw(0x0a);
    return this;
  }

  /**
   * Cut the paper, after feeding enough for the blade to clear the text.
   *
   * Printers without a cutter ignore the command, which is why the feed comes
   * first — on those the last few lines would otherwise sit inside the
   * mechanism where nobody can read them.
   */
  cut(): this { return this.feed(4).raw(GS, 0x56, 0x42, 0x00); }

  /** Everything written so far, as one buffer to hand to the transport. */
  bytes(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

/** Break a string onto rows of at most `width` columns, splitting on spaces. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  // Text that already fits is passed through untouched — re-flowing it would
  // throw away leading spaces, and those are doing work: the quantity lines on
  // a receipt are indented under the item they belong to.
  if (!text.includes('\n') && printedWidth(text) <= width) return [text];
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let row = '';
    for (const word of paragraph.split(' ')) {
      // A single word longer than the roll is chopped rather than dropped.
      if (printedWidth(word) > width) {
        if (row) { rows.push(row); row = ''; }
        let rest = word;
        while (printedWidth(rest) > width) {
          rows.push(rest.slice(0, width));
          rest = rest.slice(width);
        }
        row = rest;
        continue;
      }
      const next = row ? `${row} ${word}` : word;
      if (printedWidth(next) > width) { rows.push(row); row = word; }
      else row = next;
    }
    rows.push(row);
  }
  return rows;
}

function padStart(s: string, width: number): string {
  const gap = width - printedWidth(s);
  return gap > 0 ? ' '.repeat(gap) + s : s;
}

/**
 * Split a job into chunks a Bluetooth characteristic will accept.
 *
 * BLE writes are capped at the negotiated MTU, and these printers are cheap:
 * overrun one and it either drops the tail silently or prints nonsense. 180
 * bytes is under every MTU worth worrying about.
 */
export function chunk(data: Uint8Array, size = 180): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
  return out;
}
