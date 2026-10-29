import {
  normalizeHex,
  type LooiTransport,
  type LooiWriteOptions,
} from "@sourcebug/looi-sdk";

type MockCharacteristicKey = Parameters<LooiTransport["write"]>[0];
type MockNotificationHandler = NonNullable<
  Parameters<NonNullable<LooiTransport["startNotifications"]>>[1]
>;

export type MockLooiScenario = "clear" | "front-edge" | "rear-edge" | "obstacle" | "unknown";
export type MockLooiDirection = "stop" | "forward" | "back" | "left" | "right";
export type MockLooiHeadPosition = "up" | "center" | "down" | { raw: string };

export type MockLooiTraceEntry = {
  id: number;
  time: number;
  action: string;
  detail: string;
  repetitions?: number;
};

export type MockLooiSnapshot = {
  connected: boolean;
  direction: MockLooiDirection;
  head: MockLooiHeadPosition;
  lightEnabled: boolean;
  scenario: MockLooiScenario;
  trace: MockLooiTraceEntry[];
};

export type MockLooiGattCharacteristicSnapshot = {
  serviceUuid: string;
  uuid: string;
  key: MockCharacteristicKey;
  readable: boolean;
  writableWithResponse: boolean;
  writableWithoutResponse: boolean;
  notifiable: boolean;
  indicatable: boolean;
};

export type MockLooiGattSnapshot = {
  deviceId: string | null;
  services: string[];
  characteristics: MockLooiGattCharacteristicSnapshot[];
  availableKeys: MockCharacteristicKey[];
  legacyHandshakeAvailable: boolean;
};

export type MockLooiTransportOptions = {
  onDisconnected?: (error?: Error) => void;
  initialConnected?: boolean;
  initialScenario?: MockLooiScenario;
};

const LOOI_SERVICE_UUID = "000000ff-0000-1000-8000-00805f9b34fb";
const CHARACTERISTIC_UUIDS: Record<MockCharacteristicKey, string> = {
  drive: "0000fed0-0000-1000-8000-00805f9b34fb",
  head: "0000fed1-0000-1000-8000-00805f9b34fb",
  light: "0000fed2-0000-1000-8000-00805f9b34fb",
  dockNotify: "0000fed9-0000-1000-8000-00805f9b34fb",
  handshakeControl: "0000feda-0000-1000-8000-00805f9b34fb",
  handshakeData: "0000fef0-0000-1000-8000-00805f9b34fb",
  rawFe00: "0000fe00-0000-1000-8000-00805f9b34fb",
};
const ALL_CHARACTERISTICS = Object.keys(CHARACTERISTIC_UUIDS) as MockCharacteristicKey[];
const DRIVE_DIRECTIONS: Readonly<Record<string, MockLooiDirection>> = {
  "0000": "stop",
  "7707": "forward",
  "86fc": "back",
  "047a": "left",
  "0082": "right",
};
const SENSOR_INTERVAL_MS = 250;
const MAX_TRACE_ENTRIES = 120;

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let offset = 0; offset < hex.length; offset += 2) {
    bytes[offset / 2] = Number.parseInt(hex.slice(offset, offset + 2), 16);
  }
  return bytes;
}

function framesForScenario(scenario: MockLooiScenario): string[] {
  switch (scenario) {
    case "clear":
      // Four downward sensors see ground; 0x1fff is the SDK's no-target TOF value.
      return ["0101010101", "0eff1f"];
    case "front-edge":
      return ["0100000101", "0eff1f"];
    case "rear-edge":
      return ["0101010000", "0eff1f"];
    case "obstacle":
      // 80 mm, encoded as uint16 little endian by the FED9 decoder.
      return ["0101010101", "0e5000"];
    case "unknown":
      // No FED9 frame means the SDK's fresh-connection safety state stays unknown.
      return [];
  }
}

/**
 * In-memory LOOI BLE transport for UI and controller debugging without hardware.
 * It implements the same SDK transport seam and emits the same FED9 bytes the
 * physical adapter would forward; motion safety remains owned by LooiRobot.
 */
export class MockLooiTransport implements LooiTransport {
  private connected: boolean;
  private direction: MockLooiDirection = "stop";
  private head: MockLooiHeadPosition = "center";
  private lightEnabled = false;
  private scenario: MockLooiScenario;
  private nextTraceId = 1;
  private trace: MockLooiTraceEntry[] = [];
  private readonly onDisconnected?: (error?: Error) => void;
  private readonly snapshotListeners = new Set<(snapshot: MockLooiSnapshot) => void>();
  private readonly notificationHandlers = new Map<MockCharacteristicKey, MockNotificationHandler>();
  private sensorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MockLooiTransportOptions = {}) {
    this.connected = options.initialConnected ?? false;
    this.scenario = options.initialScenario ?? "unknown";
    this.onDisconnected = options.onDisconnected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    this.record("connected", "Mock LOOI transport connected");
    this.startSensorStreamIfReady();
    this.emitSnapshot();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      this.stopSensorStream();
      this.notificationHandlers.clear();
      return;
    }
    this.connected = false;
    this.stopSensorStream();
    this.notificationHandlers.clear();
    this.record("disconnected", "Mock LOOI transport disconnected");
    this.emitSnapshot();
  }

  hasCharacteristic(characteristicKey: MockCharacteristicKey): boolean {
    return ALL_CHARACTERISTICS.includes(characteristicKey);
  }

  getGattSnapshot(): MockLooiGattSnapshot {
    return {
      deviceId: this.connected ? "mock-looi" : null,
      services: this.connected ? [LOOI_SERVICE_UUID] : [],
      characteristics: this.connected
        ? ALL_CHARACTERISTICS.map((key) => ({
          serviceUuid: LOOI_SERVICE_UUID,
          uuid: CHARACTERISTIC_UUIDS[key],
          key,
          readable: key === "handshakeData" || key === "rawFe00",
          writableWithResponse: key === "light" || key === "handshakeControl" || key === "handshakeData" || key === "rawFe00",
          writableWithoutResponse: key === "drive" || key === "head",
          notifiable: key === "dockNotify" || key === "handshakeData",
          indicatable: false,
        }))
        : [],
      availableKeys: this.connected ? [...ALL_CHARACTERISTICS] : [],
      legacyHandshakeAvailable: this.connected,
    };
  }

  async startNotifications(
    characteristicKey: MockCharacteristicKey,
    onValue?: MockNotificationHandler,
  ): Promise<void> {
    this.assertConnected();
    if (!this.hasCharacteristic(characteristicKey)) {
      throw new Error(`Mock LOOI characteristic ${characteristicKey} is unavailable.`);
    }
    if (onValue) this.notificationHandlers.set(characteristicKey, onValue);
    else this.notificationHandlers.delete(characteristicKey);
    this.record("notifications", `${characteristicKey}:${onValue ? "subscribed" : "unsubscribed"}`);
    if (characteristicKey === "dockNotify") {
      this.stopSensorStream();
      this.emitScenarioFrames();
      this.startSensorStreamIfReady();
    }
    this.emitSnapshot();
  }

  async write(
    characteristicKey: MockCharacteristicKey,
    payloadHex: string,
    options: LooiWriteOptions = {},
  ): Promise<void> {
    this.assertConnected();
    if (!this.hasCharacteristic(characteristicKey)) {
      throw new Error(`Mock LOOI characteristic ${characteristicKey} is unavailable.`);
    }
    const payload = normalizeHex(payloadHex, options.expectedBytes ?? null);
    this.applyWrite(characteristicKey, payload);
    this.record(characteristicKey, payload, 1);
    this.emitSnapshot();
  }

  setScenario(scenario: MockLooiScenario): void {
    if (!isMockLooiScenario(scenario)) throw new Error(`Unknown mock LOOI scenario: ${String(scenario)}`);
    this.scenario = scenario;
    this.record("scenario", scenario);
    if (scenario === "unknown") this.stopSensorStream();
    else if (this.connected && this.notificationHandlers.has("dockNotify")) {
      this.stopSensorStream();
      this.emitScenarioFrames();
      this.startSensorStreamIfReady();
    }
    this.emitSnapshot();
  }

  /** Simulate a BLE link drop and notify the same recovery hook as the real adapter. */
  simulateLinkLoss(): void {
    if (!this.connected) return;
    this.connected = false;
    this.stopSensorStream();
    this.notificationHandlers.clear();
    const error = new Error("Simulated LOOI link loss");
    this.record("link-loss", error.message);
    this.emitSnapshot();
    try {
      this.onDisconnected?.(error);
    } catch {
      // A debug/recovery observer must not make the simulated transport unusable.
    }
  }

  getSnapshot(): MockLooiSnapshot {
    return {
      connected: this.connected,
      direction: this.direction,
      head: typeof this.head === "string" ? this.head : { ...this.head },
      lightEnabled: this.lightEnabled,
      scenario: this.scenario,
      trace: this.trace.map((entry) => ({ ...entry })),
    };
  }

  subscribe(listener: (snapshot: MockLooiSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  clearTrace(): void {
    this.trace = [];
    this.emitSnapshot();
  }

  /** Stop internal timers and callbacks when the debug screen permanently releases this mock. */
  dispose(): void {
    this.stopSensorStream();
    this.notificationHandlers.clear();
    this.snapshotListeners.clear();
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error("Mock LOOI is disconnected; simulated BLE writes are unavailable.");
  }

  private applyWrite(characteristicKey: MockCharacteristicKey, payload: string): void {
    if (characteristicKey === "drive") {
      if (payload.length !== 4 || !(payload in DRIVE_DIRECTIONS)) {
        throw new Error(`Unsupported mock LOOI drive payload: ${payload}`);
      }
      this.direction = DRIVE_DIRECTIONS[payload];
      return;
    }
    if (characteristicKey === "head") {
      if (payload.length !== 2) throw new Error(`Unsupported mock LOOI head payload: ${payload}`);
      if (payload === "00") this.head = "up";
      else if (payload === "87") this.head = "center";
      else if (payload === "ff") this.head = "down";
      else this.head = { raw: payload };
      return;
    }
    if (characteristicKey === "light" && (payload === "00" || payload === "01")) {
      this.lightEnabled = payload === "01";
    }
  }

  private startSensorStreamIfReady(): void {
    if (!this.connected || !this.notificationHandlers.has("dockNotify") || this.scenario === "unknown" || this.sensorTimer) return;
    this.sensorTimer = setInterval(() => this.emitScenarioFrames(), SENSOR_INTERVAL_MS);
  }

  private stopSensorStream(): void {
    if (!this.sensorTimer) return;
    clearInterval(this.sensorTimer);
    this.sensorTimer = null;
  }

  private emitScenarioFrames(): void {
    const handler = this.notificationHandlers.get("dockNotify");
    if (!this.connected || !handler) return;
    for (const hex of framesForScenario(this.scenario)) {
      if (!this.connected || this.notificationHandlers.get("dockNotify") !== handler) return;
      const bytes = bytesFromHex(hex);
      try {
        handler({ characteristic: "dockNotify", hex, bytes });
      } catch {
        // Match BLE's event boundary: receiver exceptions must not kill future notifications.
      }
    }
  }

  private record(action: string, detail: string, repetitions?: number): void {
    const now = Date.now();
    const previous = this.trace[this.trace.length - 1];
    if (previous && previous.action === action && previous.detail === detail) {
      previous.time = now;
      previous.repetitions = (previous.repetitions ?? 1) + (repetitions ?? 1);
      return;
    }
    this.trace.push({
      id: this.nextTraceId++,
      time: now,
      action,
      detail,
      ...(repetitions && repetitions > 1 ? { repetitions } : {}),
    });
    if (this.trace.length > MAX_TRACE_ENTRIES) this.trace.splice(0, this.trace.length - MAX_TRACE_ENTRIES);
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.snapshotListeners) {
      try {
        listener(snapshot);
      } catch {
        // UI observers cannot interfere with simulated transport operations.
      }
    }
  }
}

function isMockLooiScenario(value: unknown): value is MockLooiScenario {
  return value === "clear" || value === "front-edge" || value === "rear-edge" || value === "obstacle" || value === "unknown";
}
