import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EscPos, encodeText, printedWidth, wrap, chunk } from './escpos.ts';
import { buildReceipt, buildTestPrint, peso, receiptNo, type ReceiptOrder } from './receipt.ts';

/**
 * Read a print job back as the paper would look.
 *
 * Control sequences are dropped and the text kept, which is exactly what a
 * person standing at the printer sees — so a layout can be asserted on without
 * anyone owning a printer.
 */
function paper(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let row = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    // ESC @ is two bytes; every other ESC command here is three.
    if (b === 0x1b) { i += bytes[i + 1] === 0x40 ? 1 : 2; continue; }
    // GS V takes three arguments, GS ! one.
    if (b === 0x1d) { i += bytes[i + 1] === 0x56 ? 3 : 2; continue; }
    if (b === 0x0a) { out.push(row); row = ''; continue; }
    row += String.fromCharCode(b);
  }
  if (row) out.push(row);
  return out;
}

test('a peso sign becomes P, because code page 437 has no glyph for it', () => {
  assert.equal(String.fromCharCode(...encodeText('₱250.00')), 'P250.00');
  assert.equal(peso(250), 'P250.00');
});

test('ñ survives — it is in code page 437', () => {
  const bytes = encodeText('niño');
  assert.deepEqual([...bytes], [0x6e, 0x69, 0xa4, 0x6f]);
});

test('a character the printer cannot render becomes a question mark, not silence', () => {
  assert.deepEqual([...encodeText('漢')], [0x3f]);
});

test('printedWidth counts what lands on paper, not source characters', () => {
  assert.equal(printedWidth('₱100'), 4, 'the sign folds to one character');
  assert.equal(printedWidth('a…b'), 5, 'an ellipsis folds to three dots');
});

test('a row puts the value hard against the right edge', () => {
  const [row] = paper(new EscPos(32).row('Delivery fee', 'P60.00').bytes());
  assert.equal(row!.length, 32);
  assert.ok(row!.startsWith('Delivery fee'));
  assert.ok(row!.endsWith('P60.00'));
});

test('a label too long to share a row wraps, and the value keeps its column', () => {
  const rows = paper(new EscPos(32).row('Purefoods Chicken Nuggets Crazy Cut Sulit', 'P115.00').bytes());
  assert.ok(rows.length > 1, 'it wrapped');
  const last = rows[rows.length - 1]!;
  assert.equal(last.length, 32);
  assert.ok(last.endsWith('P115.00'));
});

test('wrap breaks on spaces and chops a word longer than the roll', () => {
  assert.deepEqual(wrap('one two three', 8), ['one two', 'three']);
  assert.deepEqual(wrap('supercalifragilistic', 8), ['supercal', 'ifragili', 'stic']);
});

test('chunking never exceeds the BLE write size', () => {
  const parts = chunk(new Uint8Array(500), 180);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length <= 180));
  assert.equal(parts.reduce((n, p) => n + p.length, 0), 500);
});

const SHOP = { name: 'Easy Buy Shop', address: 'Mabical', contact: '0917 000 0000' };

const ORDER: ReceiptOrder = {
  id: 'f85d3767-0dda-40fd-9554-d60d6accae3b',
  createdAt: '2026-09-14T09:22:00Z',
  serviceType: 'food',
  customerName: 'Juan Dela Cruz',
  customerContact: '09171234567',
  deliveryAddress: 'Purok 3, Pulongmasle, Guagua',
  items: [
    { name: 'Purefoods TJ Hotdogs', qty: 2, unitPrice: 65 },
    { name: 'Purefoods Chicken Nuggets', qty: 1, unitPrice: 55 },
  ],
  goodsCost: 185,
  deliveryFee: 60,
  convenienceFee: 35,
  paymentMethod: 'cod',
  paymentStatus: 'unpaid',
  carrier: 'Motor',
};

test('the receipt total reconciles to the lines above it', () => {
  const rows = paper(buildReceipt(ORDER, SHOP));
  const total = rows.find((r) => r.startsWith('TOTAL'));
  assert.ok(total, 'there is a total');
  // 185 goods + 60 delivery + 35 convenience.
  assert.ok(total.endsWith('P280.00'), `got: ${total}`);
  assert.ok(rows.some((r) => r.includes('Goods') && r.endsWith('P185.00')));
  assert.ok(rows.some((r) => r.includes('Delivery fee') && r.endsWith('P60.00')));
  assert.ok(rows.some((r) => r.includes('Convenience fee') && r.endsWith('P35.00')));
});

test('every item is named with its quantity and unit price', () => {
  const rows = paper(buildReceipt(ORDER, SHOP));
  assert.ok(rows.includes('Purefoods TJ Hotdogs'));
  const qtyRow = rows.find((r) => r.trim().startsWith('2 x P65.00'));
  assert.ok(qtyRow, 'the quantity row is there');
  assert.ok(qtyRow.endsWith('P130.00'), 'and carries the line total');
});

test('no row is wider than the roll', () => {
  for (const w of [32, 48]) {
    for (const row of paper(buildReceipt(ORDER, SHOP, w))) {
      assert.ok(row.length <= w, `"${row}" is ${row.length} on a ${w}-column roll`);
    }
  }
});

test('a corrected price shows both figures rather than a total that does not add up', () => {
  // The rider found the hotdogs cost more; goods_cost is the truth of what was
  // charged, and the receipt must not quietly disagree with itself.
  const rows = paper(buildReceipt({ ...ORDER, goodsCost: 210 }, SHOP));
  assert.ok(rows.some((r) => r.startsWith('Items') && r.endsWith('P185.00')));
  assert.ok(rows.some((r) => r.startsWith('Adjusted goods') && r.endsWith('P210.00')));
  assert.ok(rows.find((r) => r.startsWith('TOTAL'))!.endsWith('P305.00'));
});

test('an order with no itemised lines still shows its goods cost', () => {
  const rows = paper(buildReceipt(
    { ...ORDER, serviceType: 'pabili', items: [], goodsCost: 819 }, SHOP,
  ));
  assert.ok(rows.some((r) => r.startsWith('Goods') && r.endsWith('P819.00')));
  assert.ok(rows.find((r) => r.startsWith('TOTAL'))!.endsWith('P914.00'));
});

test('a pick-up says so and omits the delivery address', () => {
  const rows = paper(buildReceipt({ ...ORDER, fulfilment: 'pickup' }, SHOP));
  assert.ok(rows.some((r) => r.includes('PICK-UP')));
  assert.ok(!rows.some((r) => r.includes('Deliver to')));
});

test('a delivery names the carrier and where it is going', () => {
  const rows = paper(buildReceipt(ORDER, SHOP));
  assert.ok(rows.some((r) => r.startsWith('Carrier') && r.includes('Motor')));
  assert.ok(rows.some((r) => r.includes('Deliver to')));
});

test('the receipt number is short enough to read out loud', () => {
  assert.equal(receiptNo(ORDER.id), 'CCAE3B');
  assert.equal(receiptNo(ORDER.id).length, 6);
});

test('the test print exercises the characters most likely to break', () => {
  const rows = paper(buildTestPrint(SHOP));
  assert.ok(rows.some((r) => r.includes('PRINTER TEST')));
  assert.ok(rows.some((r) => r.includes("Pampanga's")), 'a curly apostrophe folded');
  assert.ok(rows.some((r) => r.includes('P123.45')), 'a peso amount folded');
});
