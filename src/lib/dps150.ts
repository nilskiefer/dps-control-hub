// FNIRSI DPS-150 Web Serial driver. Ported from cho45/fnirsi-dps-150 (MIT).

const HEADER_INPUT = 0xf0;
const HEADER_OUTPUT = 0xf1;

const CMD_GET = 0xa1;
const CMD_BAUD = 0xb0;
const CMD_SET = 0xb1;
const CMD_SESSION = 0xc1;

export const VOLTAGE_SET = 193;
export const CURRENT_SET = 194;

export const GROUP_VSET = [197, 199, 201, 203, 205, 207];
export const GROUP_CSET = [198, 200, 202, 204, 206, 208];

export const OVP = 209;
export const OCP = 210;
export const OPP = 211;
export const OTP = 212;
export const LVP = 213;

export const BRIGHTNESS = 214;
export const VOLUME = 215;

const METERING_ENABLE = 216;
const OUTPUT_ENABLE = 219;

const MODEL_NAME = 222;
const HARDWARE_VERSION = 223;
const FIRMWARE_VERSION = 224;
const ALL = 255;

const PROTECTION_STATES = ["", "OVP", "OCP", "OPP", "OTP", "LVP", "REP"];
const BAUD_PROFILES = [9600, 19200, 38400, 57600, 115200] as const;

export interface DeviceState {
  connected: boolean;
  modelName: string;
  hardwareVersion: string;
  firmwareVersion: string;
  inputVoltage: number;
  outputVoltage: number;
  outputCurrent: number;
  outputPower: number;
  setVoltage: number;
  setCurrent: number;
  temperature: number;
  outputClosed: boolean;
  mode: "CC" | "CV";
  protectionState: string;
  outputCapacity: number;
  outputEnergy: number;
  upperLimitVoltage: number;
  upperLimitCurrent: number;
  ovp: number;
  ocp: number;
  opp: number;
  otp: number;
  lvp: number;
  brightness: number;
  volume: number;
  groups: { v: number; c: number }[];
}

export const initialState: DeviceState = {
  connected: false,
  modelName: "",
  hardwareVersion: "",
  firmwareVersion: "",
  inputVoltage: 0,
  outputVoltage: 0,
  outputCurrent: 0,
  outputPower: 0,
  setVoltage: 0,
  setCurrent: 0,
  temperature: 0,
  outputClosed: false,
  mode: "CV",
  protectionState: "",
  outputCapacity: 0,
  outputEnergy: 0,
  upperLimitVoltage: 30,
  upperLimitCurrent: 5,
  ovp: 0,
  ocp: 0,
  opp: 0,
  otp: 0,
  lvp: 0,
  brightness: 0,
  volume: 0,
  groups: Array.from({ length: 6 }, () => ({ v: 0, c: 0 })),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Listener = (patch: Partial<DeviceState>) => void;
export type DpsLogLevel = "info" | "success" | "warn" | "error";
export type DpsLogger = (level: DpsLogLevel, message: string) => void;
export type DpsTransportErrorHandler = (error: Error) => void;

export interface SerialConnectionOptions {
  baudRate: number;
  flowControl: FlowControlType | "auto";
  dataTerminalReady: boolean;
  requestToSend: boolean;
  startupDelayMs: number;
}

export const defaultSerialConnectionOptions: SerialConnectionOptions = {
  baudRate: 9600,
  flowControl: "hardware",
  dataTerminalReady: true,
  requestToSend: true,
  startupDelayMs: 250,
};

const noopLogger: DpsLogger = () => {};

function formatPortInfo(port: SerialPort) {
  const info = port.getInfo();
  const vendor = info.usbVendorId == null ? "unknown" : `0x${info.usbVendorId.toString(16)}`;
  const product = info.usbProductId == null ? "unknown" : `0x${info.usbProductId.toString(16)}`;

  return `USB vendor ${vendor}, product ${product}`;
}

export class DPS150 {
  port: SerialPort;
  reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  listener: Listener;
  private log: DpsLogger;
  private onTransportError?: DpsTransportErrorHandler;
  private options: SerialConnectionOptions;
  private writeLock = Promise.resolve();
  private stopped = false;
  private readerHealthy = true;

  constructor(
    port: SerialPort,
    listener: Listener,
    log: DpsLogger = noopLogger,
    onTransportError?: DpsTransportErrorHandler,
    options: SerialConnectionOptions = defaultSerialConnectionOptions,
  ) {
    this.port = port;
    this.listener = listener;
    this.log = log;
    this.onTransportError = onTransportError;
    this.options = options;
  }

  async start() {
    this.log(
      "info",
      `Opening serial port (${formatPortInfo(this.port)}) at ${this.options.baudRate} baud`,
    );
    await this.openWithFallback();
    this.log("success", "Serial port open");
    await this.configureSignals();
    if (this.options.startupDelayMs > 0) {
      this.log("info", `Waiting ${this.options.startupDelayMs} ms for serial bridge to settle`);
      await sleep(this.options.startupDelayMs);
    }
    this.log("info", "Starting reader loop");
    this.startReader();
    await this.initCommand();
  }

  private async openWithFallback() {
    const flowControls: FlowControlType[] =
      this.options.flowControl === "auto" ? ["hardware", "none"] : [this.options.flowControl];
    let lastError: unknown;

    for (const flowControl of flowControls) {
      try {
        this.log("info", `Trying open with flowControl=${flowControl}`);
        await this.open(flowControl);
        return;
      } catch (error) {
        lastError = error;
        this.log(
          "warn",
          `Open with flowControl=${flowControl} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    throw lastError;
  }

  private open(flowControl: FlowControlType) {
    return this.port.open({
      baudRate: this.options.baudRate,
      bufferSize: 1024,
      dataBits: 8,
      stopBits: 1,
      flowControl,
      parity: "none",
    });
  }

  private async configureSignals() {
    try {
      await this.port.setSignals({
        dataTerminalReady: this.options.dataTerminalReady,
        requestToSend: this.options.requestToSend,
      });
      this.log(
        "info",
        `Serial signals set: DTR=${this.options.dataTerminalReady ? "on" : "off"}, RTS=${this.options.requestToSend ? "on" : "off"}`,
      );
    } catch (error) {
      this.log(
        "warn",
        `Failed to set serial signals: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async stop() {
    this.stopped = true;
    this.log("info", "Disconnecting serial session");
    try {
      await this.send(HEADER_OUTPUT, CMD_SESSION, 0, [0]);
    } catch (error) {
      this.log(
        "warn",
        `Failed to close DPS session: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.debug("Failed to close DPS session", error);
    }
    try {
      await this.reader?.cancel();
    } catch (error) {
      this.log(
        "warn",
        `Failed to cancel serial reader: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.debug("Failed to cancel DPS reader", error);
    }
    try {
      await this.port.close();
      this.log("success", "Serial port closed");
    } catch (error) {
      this.log(
        "warn",
        `Failed to close serial port: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.debug("Failed to close serial port", error);
    }
  }

  private async startReader() {
    let buffer = new Uint8Array();
    while (this.port.readable && !this.stopped) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          if (!value) continue;
          const b = new Uint8Array(buffer.length + value.length);
          b.set(buffer);
          b.set(value, buffer.length);
          buffer = b;
          let i = 0;
          while (i < buffer.length - 6) {
            if (buffer[i] === 0xf0 && buffer[i + 1] === 0xa1) {
              const c3 = buffer[i + 2];
              const c4 = buffer[i + 3];
              if (i + 4 + c4 >= buffer.length) break;
              const c5 = buffer.subarray(i + 4, i + 4 + c4);
              const c6 = buffer[i + 4 + c4];
              let s6 = c3 + c4;
              for (let j = 0; j < c4; j++) s6 += c5[j];
              s6 %= 0x100;
              if (s6 === c6) this.parseData(c3, new Uint8Array(c5));
              i = i + 4 + c4 + 1;
            } else {
              i++;
            }
          }
          buffer = buffer.subarray(i);
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        this.readerHealthy = false;
        this.listener({ connected: false });
        this.log("error", `Serial read failed: ${error.message}`);
        this.onTransportError?.(error);
        console.warn("read error", error);
        return;
      } finally {
        try {
          reader.releaseLock();
        } catch (error) {
          console.debug("Failed to release serial reader lock", error);
        }
      }
    }
  }

  private async initCommand() {
    this.log("info", "Entering DPS command session");
    await this.send(HEADER_OUTPUT, CMD_SESSION, 0, [1]);
    this.assertReaderHealthy();
    this.log("info", `Setting DPS baud profile to ${this.options.baudRate}`);
    await this.send(HEADER_OUTPUT, CMD_BAUD, 0, [this.getBaudProfile()]);
    this.assertReaderHealthy();
    this.log("info", "Requesting model, firmware, limits, and live state");
    await this.send(HEADER_OUTPUT, CMD_GET, MODEL_NAME, [0]);
    this.assertReaderHealthy();
    await this.send(HEADER_OUTPUT, CMD_GET, HARDWARE_VERSION, [0]);
    this.assertReaderHealthy();
    await this.send(HEADER_OUTPUT, CMD_GET, FIRMWARE_VERSION, [0]);
    this.assertReaderHealthy();
    await this.send(HEADER_OUTPUT, CMD_GET, ALL, [0]);
    this.assertReaderHealthy();
    this.listener({ connected: true });
    this.log("success", "DPS-150 command session ready");
  }

  private assertReaderHealthy() {
    if (!this.readerHealthy) {
      throw new Error("Serial reader stopped during startup. The device was opened but then lost.");
    }
  }

  private getBaudProfile() {
    const profile = BAUD_PROFILES.indexOf(this.options.baudRate as (typeof BAUD_PROFILES)[number]);
    if (profile === -1) {
      throw new Error(`Unsupported DPS baud profile: ${this.options.baudRate}`);
    }
    return profile + 1;
  }

  private async send(
    c1: number,
    c2: number,
    c3: number,
    payload: number[] | Uint8Array,
    logTx = true,
  ) {
    if (!this.readerHealthy) {
      throw new Error("Serial reader is stopped; refusing to write to a lost device");
    }

    const arr = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const c4 = arr.length;
    let c6 = c3 + c4;
    for (let i = 0; i < c4; i++) c6 += arr[i];
    const out = new Uint8Array(arr.length + 5);
    out[0] = c1;
    out[1] = c2;
    out[2] = c3;
    out[3] = c4;
    out.set(arr, 4);
    out[out.length - 1] = c6 & 0xff;

    // serialize writes
    const prev = this.writeLock;
    let release!: () => void;
    this.writeLock = new Promise((r) => (release = r));
    await prev;
    try {
      const writer = this.port.writable!.getWriter();
      try {
        if (logTx) {
          this.log("info", `TX cmd 0x${c2.toString(16)} addr 0x${c3.toString(16)} (${c4} bytes)`);
        }
        await writer.write(out);
        await sleep(40);
      } finally {
        writer.releaseLock();
      }
    } finally {
      release();
    }
  }

  private async sendFloat(c3: number, value: number) {
    const v = new DataView(new ArrayBuffer(4));
    v.setFloat32(0, value, true);
    await this.send(HEADER_OUTPUT, CMD_SET, c3, new Uint8Array(v.buffer));
  }

  setVoltage(v: number) {
    return this.sendFloat(VOLTAGE_SET, v);
  }
  setCurrent(a: number) {
    return this.sendFloat(CURRENT_SET, a);
  }
  setOvp(v: number) {
    return this.sendFloat(OVP, v);
  }
  setOcp(a: number) {
    return this.sendFloat(OCP, a);
  }
  setOpp(w: number) {
    return this.sendFloat(OPP, w);
  }
  setOtp(t: number) {
    return this.sendFloat(OTP, t);
  }
  setLvp(v: number) {
    return this.sendFloat(LVP, v);
  }
  setGroupV(idx: number, v: number) {
    return this.sendFloat(GROUP_VSET[idx], v);
  }
  setGroupC(idx: number, a: number) {
    return this.sendFloat(GROUP_CSET[idx], a);
  }

  async enable() {
    this.log("info", "Enabling output");
    await this.send(HEADER_OUTPUT, CMD_SET, OUTPUT_ENABLE, [1]);
    await this.refresh();
  }
  async disable() {
    this.log("info", "Disabling output");
    await this.send(HEADER_OUTPUT, CMD_SET, OUTPUT_ENABLE, [0]);
    await this.refresh();
  }
  async refresh() {
    await this.send(HEADER_OUTPUT, CMD_GET, ALL, [0], false);
  }

  private parseData(c3: number, c5: Uint8Array) {
    const view = new DataView(c5.buffer, c5.byteOffset, c5.byteLength);
    switch (c3) {
      case 192:
        this.listener({ inputVoltage: view.getFloat32(0, true) });
        break;
      case 195:
        this.listener({
          outputVoltage: view.getFloat32(0, true),
          outputCurrent: view.getFloat32(4, true),
          outputPower: view.getFloat32(8, true),
        });
        break;
      case 196:
        this.listener({ temperature: view.getFloat32(0, true) });
        break;
      case 217:
        this.listener({ outputCapacity: view.getFloat32(0, true) });
        break;
      case 218:
        this.listener({ outputEnergy: view.getFloat32(0, true) });
        break;
      case 219:
        this.listener({ outputClosed: c5[0] === 1 });
        break;
      case 220:
        this.listener({ protectionState: PROTECTION_STATES[c5[0]] || "" });
        break;
      case 221:
        this.listener({ mode: c5[0] === 0 ? "CC" : "CV" });
        break;
      case 222:
        this.listener({ modelName: String.fromCharCode(...c5).trim() });
        break;
      case 223:
        this.listener({ hardwareVersion: String.fromCharCode(...c5).trim() });
        break;
      case 224:
        this.listener({ firmwareVersion: String.fromCharCode(...c5).trim() });
        break;
      case 226:
        this.listener({ upperLimitVoltage: view.getFloat32(0, true) });
        break;
      case 227:
        this.listener({ upperLimitCurrent: view.getFloat32(0, true) });
        break;
      case 255: {
        const groups = Array.from({ length: 6 }, (_, i) => ({
          v: view.getFloat32(28 + i * 8, true),
          c: view.getFloat32(32 + i * 8, true),
        }));
        this.listener({
          inputVoltage: view.getFloat32(0, true),
          setVoltage: view.getFloat32(4, true),
          setCurrent: view.getFloat32(8, true),
          outputVoltage: view.getFloat32(12, true),
          outputCurrent: view.getFloat32(16, true),
          outputPower: view.getFloat32(20, true),
          temperature: view.getFloat32(24, true),
          groups,
          ovp: view.getFloat32(76, true),
          ocp: view.getFloat32(80, true),
          opp: view.getFloat32(84, true),
          otp: view.getFloat32(88, true),
          lvp: view.getFloat32(92, true),
          brightness: c5[96],
          volume: c5[97],
          outputCapacity: view.getFloat32(99, true),
          outputEnergy: view.getFloat32(103, true),
          outputClosed: c5[107] === 1,
          protectionState: PROTECTION_STATES[c5[108]] || "",
          mode: c5[109] === 0 ? "CC" : "CV",
          upperLimitVoltage: view.getFloat32(111, true),
          upperLimitCurrent: view.getFloat32(115, true),
        });
        break;
      }
    }
  }
}

// Web Serial type fallback
declare global {
  interface SerialPort {
    open(opts: SerialOptions): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
  }
  interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
    bufferSize?: number;
    flowControl?: "none" | "hardware";
  }
  interface Serial {
    requestPort(opts?: {
      filters?: { usbVendorId?: number; usbProductId?: number }[];
    }): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
  }
  interface Navigator {
    serial: Serial;
  }
}
