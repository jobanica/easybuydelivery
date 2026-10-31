/**
 * Talking to a Bluetooth receipt printer from the browser.
 *
 * Web Bluetooth, so: Chrome on Android or desktop, over HTTPS, and only ever
 * from a real tap — the browser will not open the device picker from code that
 * the user did not just click. None of that is negotiable, and Safari does not
 * implement the API at all, so an iPhone cannot do this no matter what we
 * write. `printingSupport()` exists to say which of those walls you are looking
 * at, because "nothing happened" is the worst possible answer at a counter.
 *
 * The printers themselves are cheap and varied. They expose a serial-ish
 * characteristic under one of a handful of vendor service UUIDs, none of them
 * standard, so rather than guessing we ask for every service we have seen in
 * the wild and then hunt for anything writable. Writes go out in small chunks
 * with a breath between them: overrun one of these and it drops the tail
 * silently, which prints half a receipt and looks like a success.
 */

import { chunk } from '@ebd/shared';

/** Service UUIDs cheap 58mm BLE printers are known to advertise. */
const PRINTER_SERVICES = [
  0x18f0, 0xff00, 0xffe0, 0xfff0, 0xae30, 0xff80, 0xffb0,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

const WIDTH_KEY = 'ebd:printer-width';
const NAME_KEY = 'ebd:printer-name';

export type PrintSupport =
  | { ok: true }
  | { ok: false; reason: 'insecure' | 'unsupported'; detail: string };

/** Whether this browser can print at all, and if not, why not. */
export function printingSupport(): PrintSupport {
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
    return {
      ok: false,
      reason: 'unsupported',
      detail: 'This browser can’t talk to Bluetooth devices. Use Chrome on Android or a computer — '
        + 'iPhone and iPad can’t do it at all, Safari doesn’t support Web Bluetooth.',
    };
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return {
      ok: false,
      reason: 'insecure',
      detail: 'Bluetooth needs a secure connection. Open the console over https.',
    };
  }
  return { ok: true };
}

/** Columns on the roll: 32 for a 58mm printer, 48 for an 80mm one. */
export function paperWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return v === 48 ? 48 : 32;
  } catch { return 32; }
}

export function setPaperWidth(cols: 32 | 48) {
  try { localStorage.setItem(WIDTH_KEY, String(cols)); } catch { /* private mode */ }
}

/** The printer paired last, so the console can say what it will print to. */
export function lastPrinterName(): string | null {
  try { return localStorage.getItem(NAME_KEY); } catch { return null; }
}

// Kept for the life of the page: reconnecting costs a second or two, and a
// counter printing a run of receipts should not pay it on every one.
let device: BluetoothDevice | null = null;
let characteristic: BluetoothRemoteGATTCharacteristic | null = null;

/** Forget the paired printer, so the next print asks again. */
export function forgetPrinter() {
  try { device?.gatt?.disconnect(); } catch { /* already gone */ }
  device = null;
  characteristic = null;
  try { localStorage.removeItem(NAME_KEY); } catch { /* private mode */ }
}

/**
 * Ask the browser for a printer. Must be called straight from a click.
 *
 * `acceptAllDevices` rather than a service filter, because half these printers
 * advertise nothing useful in their scan response and would simply not appear
 * in a filtered picker — better to show everything and let the operator pick
 * the one whose name is printed on the case.
 */
export async function choosePrinter(): Promise<string> {
  const support = printingSupport();
  if (!support.ok) throw new Error(support.detail);

  const d = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });
  device = d;
  characteristic = null;
  const name = d.name || 'Printer';
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
  await connect();
  return name;
}

/** Connect and find something we can write bytes to. */
async function connect(): Promise<BluetoothRemoteGATTCharacteristic> {
  if (characteristic && device?.gatt?.connected) return characteristic;
  if (!device) throw new Error('No printer chosen yet.');

  const server = await device.gatt?.connect();
  if (!server) throw new Error('Could not connect to the printer.');

  // Try the services we know first; if the printer is something else entirely,
  // fall back to walking everything it exposes.
  let services: BluetoothRemoteGATTService[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch {
    for (const uuid of PRINTER_SERVICES) {
      try { services.push(await server.getPrimaryService(uuid)); } catch { /* not this one */ }
    }
  }

  for (const service of services) {
    let chars: BluetoothRemoteGATTCharacteristic[] = [];
    try { chars = await service.getCharacteristics(); } catch { continue; }
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        characteristic = c;
        return c;
      }
    }
  }
  throw new Error('That device has no printable channel — is it a receipt printer?');
}

/**
 * Send a job to the printer.
 *
 * Opens the picker on the first print of a session; after that it reuses the
 * connection. The pause between chunks is not superstition — without it these
 * printers drop bytes and you get a receipt missing its total.
 */
export async function printBytes(data: Uint8Array): Promise<void> {
  const support = printingSupport();
  if (!support.ok) throw new Error(support.detail);
  if (!device) await choosePrinter();

  const c = await connect();
  for (const part of chunk(data, 180)) {
    // A fresh copy per write: some stacks hold the buffer past the call.
    const buf = Uint8Array.from(part);
    if (c.properties.writeWithoutResponse) await c.writeValueWithoutResponse(buf);
    else await c.writeValue(buf);
    await new Promise((r) => setTimeout(r, 24));
  }
}
