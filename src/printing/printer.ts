/**
 * Printer transport abstraction. Screens call `printer.print(bytes)` and never
 * know which Bluetooth library is underneath.
 *
 * Your field printers are 3-inch Bluetooth CLASSIC (SPP) devices, so the real
 * implementation needs a native SPP module (e.g. react-native-bluetooth-classic)
 * in an EAS development build — Expo Go cannot load it. Until that is wired in,
 * the console transport below lets every screen be built and tested.
 */
export interface PrinterDevice {
  name: string;
  address: string;
}

export interface PrinterTransport {
  listPaired(): Promise<PrinterDevice[]>;
  connect(address: string): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}

class ConsoleTransport implements PrinterTransport {
  async listPaired() {
    return [{ name: 'Console (dev)', address: 'console' }];
  }
  async connect() {}
  async write(bytes: Uint8Array) {
    // Strip control bytes so the receipt is readable in Metro logs.
    console.log(String.fromCharCode(...bytes.filter((b) => b === 0x0a || (b >= 0x20 && b < 0x7f))));
  }
  async disconnect() {}
}

let transport: PrinterTransport = new ConsoleTransport();

/** Swap in the real Bluetooth transport at startup once the native module is added. */
export const setPrinterTransport = (t: PrinterTransport) => {
  transport = t;
};

export const printer = {
  listPaired: () => transport.listPaired(),
  async print(address: string, bytes: Uint8Array) {
    await transport.connect(address);
    try {
      await transport.write(bytes);
    } finally {
      await transport.disconnect();
    }
  },
};
