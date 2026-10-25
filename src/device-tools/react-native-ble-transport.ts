import { AppState, PermissionsAndroid, Platform } from "react-native";
import {
  BleManager,
  ScanMode,
  State,
  type Device,
  type Subscription,
} from "react-native-ble-plx";
import {
  bytesToHex,
  hexToBytes,
  type LooiTransport,
  type LooiWriteOptions,
} from "@sourcebug/looi-sdk";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";

type LooiCharacteristicKey = Parameters<LooiTransport["write"]>[0];
type LooiNotificationHandler = NonNullable<
  Parameters<NonNullable<LooiTransport["startNotifications"]>>[1]
>;

const LOOI_SERVICE_UUID = "000000ff-0000-1000-8000-00805f9b34fb";
const DEFAULT_ROBOT_NAME = "LOOI Robot";
const DEFAULT_SCAN_TIMEOUT_MS = 12_000;
const DEFAULT_BLE_STATE_TIMEOUT_MS = 8_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

const CHARACTERISTIC_UUIDS: Record<LooiCharacteristicKey, string> = {
  drive: "0000fed0-0000-1000-8000-00805f9b34fb",
  head: "0000fed1-0000-1000-8000-00805f9b34fb",
  light: "0000fed2-0000-1000-8000-00805f9b34fb",
  dockNotify: "0000fed9-0000-1000-8000-00805f9b34fb",
  handshakeControl: "0000feda-0000-1000-8000-00805f9b34fb",
  handshakeData: "0000fef0-0000-1000-8000-00805f9b34fb",
  rawFe00: "0000fe00-0000-1000-8000-00805f9b34fb",
};

export type ReactNativeBleLooiTransportOptions = {
  manager?: BleManager;
  deviceId?: string;
  robotName?: string;
  scanTimeoutMs?: number;
  bleStateTimeoutMs?: number;
  connectTimeoutMs?: number;
  isConnectionAllowed?: () => boolean;
  onDisconnected?: (error?: Error) => void;
};

export type ScannedLooiRobot = {
  id: string;
  name: string;
  rssi: number | null;
  serviceUUIDs: string[];
};

type ResolvedCharacteristic = {
  serviceUuid: string;
  characteristicUuid: string;
  writableWithResponse: boolean;
  writableWithoutResponse: boolean;
  notifiable: boolean;
  indicatable: boolean;
};

export type LooiGattCharacteristicSnapshot = {
  serviceUuid: string;
  uuid: string;
  key: LooiCharacteristicKey | null;
  readable: boolean;
  writableWithResponse: boolean;
  writableWithoutResponse: boolean;
  notifiable: boolean;
  indicatable: boolean;
};

export type LooiGattSnapshot = {
  deviceId: string | null;
  services: string[];
  characteristics: LooiGattCharacteristicSnapshot[];
  availableKeys: LooiCharacteristicKey[];
  legacyHandshakeAvailable: boolean;
};

function emptyGattSnapshot(): LooiGattSnapshot {
  return { deviceId: null, services: [], characteristics: [], availableKeys: [], legacyHandshakeAvailable: false };
}

export class ReactNativeBleLooiTransport implements LooiTransport {
  private readonly manager: BleManager;
  private readonly preferredDeviceId: string | null;
  private readonly robotName: string;
  private readonly scanTimeoutMs: number;
  private readonly bleStateTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly onDisconnected?: (error?: Error) => void;
  private readonly isConnectionAllowed: () => boolean;
  private connectionGeneration = 0;
  private connectionPromise: Promise<void> | null = null;
  private connectionQueue: Promise<unknown> = Promise.resolve();
  private teardownPromise: Promise<unknown> = Promise.resolve();
  private pendingDeviceId: string | null = null;
  private connectionCancellation: AbortController | null = null;
  private deviceId: string | null = null;
  private disconnectSubscription: Subscription | null = null;
  private notificationSubscriptions = new Map<LooiCharacteristicKey, Subscription>();
  private resolvedCharacteristics = new Map<LooiCharacteristicKey, ResolvedCharacteristic>();
  private gattSnapshot = emptyGattSnapshot();

  constructor(options: ReactNativeBleLooiTransportOptions = {}) {
    this.manager = options.manager ?? new BleManager();
    this.preferredDeviceId = options.deviceId ?? null;
    this.robotName = options.robotName ?? process.env.EXPO_PUBLIC_LOOI_ROBOT_NAME ?? DEFAULT_ROBOT_NAME;
    this.scanTimeoutMs = options.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
    this.bleStateTimeoutMs = options.bleStateTimeoutMs ?? DEFAULT_BLE_STATE_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.onDisconnected = options.onDisconnected;
    this.isConnectionAllowed = options.isConnectionAllowed ?? (() => true);
  }

  connect(): Promise<void> {
    if (this.connectionPromise) return this.connectionPromise;
    const generation = ++this.connectionGeneration;
    const cancellation = new AbortController();
    this.connectionCancellation = cancellation;
    const attempt = this.connectionQueue.then(async () => {
      await this.teardownPromise;
      this.assertConnectionActive(generation);
      await this.performConnect(generation, cancellation.signal);
    }).catch(async (error) => {
      if (generation === this.connectionGeneration) await this.disconnect();
      throw error;
    });
    this.connectionQueue = attempt.catch(() => undefined);
    this.connectionPromise = attempt;
    const release = () => { if (this.connectionPromise === attempt) this.connectionPromise = null; };
    void attempt.then(release, release);
    return attempt;
  }

  private assertConnectionActive(generation: number): void {
    if (generation !== this.connectionGeneration || !this.isConnectionAllowed()) {
      throw new Error("LOOI BLE connection cancelled");
    }
  }

  private async performConnect(generation: number, signal: AbortSignal): Promise<void> {
    if (Platform.OS === "web") {
      throw new Error("LOOI BLE transport requires a native iOS or Android runtime.");
    }

    this.assertConnectionActive(generation);
    await requestAndroidBluetoothPermissions();
    this.assertConnectionActive(generation);
    await waitForManagerPoweredOn(this.manager, this.bleStateTimeoutMs, signal);
    this.assertConnectionActive(generation);

    const selected = await this.findRobotDevice(generation, signal);
    this.assertConnectionActive(generation);
    const { device, adoption } = await this.connectDevice(selected, generation);

    if (generation !== this.connectionGeneration || !this.isConnectionAllowed()) {
      // Some native adapters complete connect after acknowledging cancellation.
      // The next queued attempt waits until this late link has been released.
      await this.manager.cancelDeviceConnection(device.id).catch(() => {});
      this.assertConnectionActive(generation);
    }
    this.observeDisconnection(device.id, generation);
    if (adoption) {
      recordDiagnosticEvent("robot", "ble-existing-connection-adopted", { deviceId: device.id, ...adoption });
    }

    await this.manager.discoverAllServicesAndCharacteristicsForDevice(device.id);
    this.assertConnectionActive(generation);
    await this.discoverGatt(device.id, generation);
    this.assertConnectionActive(generation);
    if (adoption) {
      recordDiagnosticEvent("robot", "ble-existing-connection-gatt-restored", {
        deviceId: device.id,
        availableKeys: this.gattSnapshot.availableKeys.join(","),
      });
    }

    if (Platform.OS === "android") {
      await this.manager.requestMTUForDevice(device.id, 185).catch((error) => {
        console.warn("[LOOI BLE] MTU request failed; continuing with default MTU", error);
      });
    }
    this.assertConnectionActive(generation);
  }

  private async connectDevice(device: Device, generation: number): Promise<{
    device: Device;
    adoption?: { reason: string; connectError?: string };
  }> {
    const connected = await this.manager.isDeviceConnected(device.id).catch(() => false);
    this.assertConnectionActive(generation);
    if (connected) return { device, adoption: { reason: "manager-is-connected" } };

    this.pendingDeviceId = device.id;
    try {
      return { device: await this.manager.connectToDevice(device.id, { timeout: this.connectTimeoutMs }) };
    } catch (error) {
      this.assertConnectionActive(generation);
      const connectError = error instanceof Error ? error.message : String(error);
      const connectedAfterError = await this.manager.isDeviceConnected(device.id).catch(() => false);
      this.assertConnectionActive(generation);
      if (!connectedAfterError && !/already connected/i.test(connectError)) throw error;
      // The platform can retain its GATT link after a lifecycle cancellation.
      // Adopt that link and rediscover it instead of requesting a second one.
      return { device, adoption: {
        reason: connectedAfterError ? "connected-after-connect-error" : "already-connected-error",
        connectError,
      } };
    }
  }

  private observeDisconnection(deviceId: string, generation: number): void {
    this.deviceId = deviceId;
    this.pendingDeviceId = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = this.manager.onDeviceDisconnected(deviceId, (error) => {
      if (generation !== this.connectionGeneration || this.deviceId !== deviceId) return;
      this.connectionGeneration += 1;
      this.connectionCancellation?.abort();
      this.clearConnectionState();
      const normalized = error instanceof Error ? error : error ? new Error(String(error)) : undefined;
      recordDiagnosticEvent("robot", "ble-link-lost", { deviceId, error: normalized?.message ?? "disconnected" });
      this.onDisconnected?.(normalized);
    });
  }

  private clearConnectionState(): void {
    this.deviceId = null;
    this.pendingDeviceId = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
    for (const subscription of this.notificationSubscriptions.values()) subscription.remove();
    this.notificationSubscriptions.clear();
    this.resolvedCharacteristics.clear();
    this.gattSnapshot = emptyGattSnapshot();
  }

  async disconnect(): Promise<void> {
    this.connectionGeneration += 1;
    this.connectionPromise = null;
    this.connectionCancellation?.abort();
    this.connectionCancellation = null;
    const deviceIds = new Set([this.deviceId, this.pendingDeviceId]);
    this.clearConnectionState();
    const teardown = Promise.all([...deviceIds]
      .filter((id): id is string => id !== null)
      .map((id) => this.manager.cancelDeviceConnection(id).catch(() => {})));
    this.teardownPromise = Promise.allSettled([this.teardownPromise, teardown]);
    await this.teardownPromise;
  }

  hasCharacteristic(characteristicKey: LooiCharacteristicKey): boolean {
    return this.resolvedCharacteristics.has(characteristicKey);
  }

  getGattSnapshot(): LooiGattSnapshot {
    return {
      ...this.gattSnapshot,
      services: [...this.gattSnapshot.services],
      characteristics: this.gattSnapshot.characteristics.map((item) => ({ ...item })),
      availableKeys: [...this.gattSnapshot.availableKeys],
    };
  }

  async startNotifications(
    characteristicKey: LooiCharacteristicKey,
    onValue?: LooiNotificationHandler,
  ): Promise<void> {
    const deviceId = this.requireDeviceId();
    const generation = this.connectionGeneration;
    const resolved = this.requireResolvedCharacteristic(characteristicKey);

    if (!resolved.notifiable && !resolved.indicatable) {
      throw new Error(`LOOI BLE characteristic ${shortUuid(resolved.characteristicUuid)} (${characteristicKey}) does not support notifications.`);
    }

    this.notificationSubscriptions.get(characteristicKey)?.remove();

    const subscription = this.manager.monitorCharacteristicForDevice(
      deviceId,
      resolved.serviceUuid,
      resolved.characteristicUuid,
      (error, characteristic) => {
        if (generation !== this.connectionGeneration || this.deviceId !== deviceId) return;
        if (error) {
          console.warn(`[LOOI BLE] Notification failed for ${characteristicKey}`, error);
          return;
        }
        if (!onValue || !characteristic?.value) return;
        const bytes = base64ToBytes(characteristic.value);
        onValue({ characteristic: characteristicKey, hex: bytesToHex(bytes), bytes });
      },
      `looi-notify-${characteristicKey}`,
    );

    this.notificationSubscriptions.set(characteristicKey, subscription);
  }

  async write(
    characteristicKey: LooiCharacteristicKey,
    payloadHex: string,
    options: LooiWriteOptions = {},
  ): Promise<void> {
    const deviceId = this.requireDeviceId();
    const resolved = this.requireResolvedCharacteristic(characteristicKey);
    const value = bytesToBase64(hexToBytes(payloadHex, options.expectedBytes ?? null));

    const prefersWithoutResponse = options.response === false;
    if (prefersWithoutResponse && resolved.writableWithoutResponse) {
      await this.manager.writeCharacteristicWithoutResponseForDevice(
        deviceId,
        resolved.serviceUuid,
        resolved.characteristicUuid,
        value,
      );
      return;
    }

    if (resolved.writableWithResponse) {
      await this.manager.writeCharacteristicWithResponseForDevice(
        deviceId,
        resolved.serviceUuid,
        resolved.characteristicUuid,
        value,
      );
      return;
    }

    if (resolved.writableWithoutResponse) {
      await this.manager.writeCharacteristicWithoutResponseForDevice(
        deviceId,
        resolved.serviceUuid,
        resolved.characteristicUuid,
        value,
      );
      return;
    }

    throw new Error(`LOOI BLE characteristic ${shortUuid(resolved.characteristicUuid)} (${characteristicKey}) is not writable.`);
  }

  private async discoverGatt(deviceId: string, generation: number): Promise<void> {
    this.resolvedCharacteristics.clear();
    const services = await this.manager.servicesForDevice(deviceId);
    this.assertConnectionActive(generation);
    const characteristicSnapshots: LooiGattCharacteristicSnapshot[] = [];

    for (const service of services) {
      const characteristics = await this.manager.characteristicsForDevice(deviceId, service.uuid).catch(() => []);
      this.assertConnectionActive(generation);
      for (const characteristic of characteristics) {
        const key = findCharacteristicKey(characteristic.uuid);
        characteristicSnapshots.push({
          serviceUuid: service.uuid,
          uuid: characteristic.uuid,
          key,
          readable: Boolean(characteristic.isReadable),
          writableWithResponse: Boolean(characteristic.isWritableWithResponse),
          writableWithoutResponse: Boolean(characteristic.isWritableWithoutResponse),
          notifiable: Boolean(characteristic.isNotifiable),
          indicatable: Boolean(characteristic.isIndicatable),
        });
        if (key && !this.resolvedCharacteristics.has(key)) {
          this.resolvedCharacteristics.set(key, {
            serviceUuid: service.uuid,
            characteristicUuid: characteristic.uuid,
            writableWithResponse: Boolean(characteristic.isWritableWithResponse),
            writableWithoutResponse: Boolean(characteristic.isWritableWithoutResponse),
            notifiable: Boolean(characteristic.isNotifiable),
            indicatable: Boolean(characteristic.isIndicatable),
          });
        }
      }
    }

    const availableKeys = [...this.resolvedCharacteristics.keys()];
    this.gattSnapshot = {
      deviceId,
      services: services.map((service) => service.uuid),
      characteristics: characteristicSnapshots,
      availableKeys,
      legacyHandshakeAvailable:
        this.resolvedCharacteristics.has("handshakeControl") &&
        this.resolvedCharacteristics.has("handshakeData"),
    };

    const compact = characteristicSnapshots.map((item) => `${shortUuid(item.uuid)}${item.key ? `:${item.key}` : ""}`).join(",");
    console.log(`[LOOI BLE] GATT discovered: ${compact || "no characteristics"}`);
    recordDiagnosticEvent("robot", "ble-gatt-discovered", {
      deviceId,
      serviceCount: services.length,
      characteristics: compact,
      availableKeys: availableKeys.join(","),
      legacyHandshakeAvailable: this.gattSnapshot.legacyHandshakeAvailable,
    });
  }

  private requireResolvedCharacteristic(characteristicKey: LooiCharacteristicKey): ResolvedCharacteristic {
    const resolved = this.resolvedCharacteristics.get(characteristicKey);
    if (resolved) return resolved;
    throw new Error(`LOOI BLE characteristic ${shortUuid(CHARACTERISTIC_UUIDS[characteristicKey])} (${characteristicKey}) is not exposed by this robot firmware.`);
  }

  private async findRobotDevice(generation: number, signal: AbortSignal): Promise<Device> {
    if (this.preferredDeviceId) {
      const connected = await this.manager.connectedDevices([LOOI_SERVICE_UUID]).catch(() => []);
      this.assertConnectionActive(generation);
      const connectedMatch = connected.find((device) => device.id === this.preferredDeviceId);
      if (connectedMatch) return connectedMatch;

      const known = await this.manager.devices([this.preferredDeviceId]).catch(() => []);
      this.assertConnectionActive(generation);
      if (known[0]) return known[0];
      return {
        id: this.preferredDeviceId,
        name: this.robotName,
        localName: this.robotName,
        serviceUUIDs: [LOOI_SERVICE_UUID],
      } as Device;
    }

    const connected = await this.manager.connectedDevices([LOOI_SERVICE_UUID]).catch(() => []);
    this.assertConnectionActive(generation);
    const connectedMatch = connected.find((device) => isLikelyLooiRobot(device, this.robotName)) ?? connected[0];
    if (connectedMatch) return connectedMatch;

    console.log(`[LOOI BLE] Scanning for ${this.robotName} by name or LOOI service`);

    const devices = await scanLooiDevices(this.manager, {
      robotName: this.robotName, timeoutMs: this.scanTimeoutMs, signal, mode: "first-match",
    });
    const first = devices[0];
    if (!first) throw new Error(`LOOI robot not found within ${this.scanTimeoutMs}ms`);
    return first;
  }

  private requireDeviceId(): string {
    if (!this.deviceId) {
      throw new Error("LOOI BLE device is not connected.");
    }
    return this.deviceId;
  }
}

export async function scanLooiRobotCandidates(options: {
  scanTimeoutMs?: number;
  robotName?: string;
} = {}): Promise<ScannedLooiRobot[]> {
  if (Platform.OS === "web") return [];
  if (AppState.currentState !== "active") throw new Error("Robot search requires the app to be active");

  await requestAndroidBluetoothPermissions();
  if (AppState.currentState !== "active") throw new Error("Robot search cancelled in background");

  const manager = new BleManager();
  // BleManager's constructor returns its process-wide singleton. Destroying it
  // after a Settings scan also destroys an existing robot's active GATT session.
  const lifecycle = new AbortController();
  const subscription = AppState.addEventListener("change", (state) => {
    if (state !== "active") lifecycle.abort();
  });
  const robotName = options.robotName ?? process.env.EXPO_PUBLIC_LOOI_ROBOT_NAME ?? DEFAULT_ROBOT_NAME;
  const scanTimeoutMs = options.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;

  try {
    await waitForManagerPoweredOn(manager, DEFAULT_BLE_STATE_TIMEOUT_MS, lifecycle.signal);
    const devices = await scanLooiDevices(manager, {
      robotName, timeoutMs: scanTimeoutMs, signal: lifecycle.signal, mode: "collect",
    });
    return devices.map(toScannedRobot).sort(compareScannedRobots);
  } catch (error) {
    if (lifecycle.signal.aborted) throw new Error("Robot search cancelled in background");
    throw error;
  } finally {
    subscription.remove();
  }
}

async function requestAndroidBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;

  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(permissions);
  const denied = permissions.filter((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length > 0) {
    throw new Error(`Bluetooth permissions denied: ${denied.join(", ")}`);
  }
}

function assertBluetoothOperationActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("LOOI Bluetooth operation cancelled");
}

// The native manager has one global scanner. Hold its lease through stop(), so
// a delayed cleanup can never stop another caller's replacement search.
const scanningManagers = new WeakSet<BleManager>();

async function scanLooiDevices(manager: BleManager, options: {
  robotName: string;
  timeoutMs: number;
  signal: AbortSignal;
  mode: "first-match" | "collect";
}): Promise<Device[]> {
  const { signal, robotName, timeoutMs, mode } = options;
  assertBluetoothOperationActive(signal);
  if (scanningManagers.has(manager)) throw new Error("A Bluetooth search is already running");
  scanningManagers.add(manager);
  let result: Device[];
  try {
    result = await new Promise<Device[]>((resolve, reject) => {
      const devices = new Map<string, Device>();
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancelled);
        if (error !== undefined) reject(error);
        else resolve([...devices.values()]);
      };
      const cancelled = () => finish(new Error("LOOI Bluetooth operation cancelled"));
      const timeout = setTimeout(() => finish(), timeoutMs);
      signal.addEventListener("abort", cancelled, { once: true });
      try {
        void manager.startDeviceScan(null, {
          allowDuplicates: false,
          scanMode: Platform.OS === "android" ? ScanMode.LowLatency : undefined,
        }, (error, device) => {
          if (settled) return;
          if (error) { finish(error); return; }
          if (!device || !isLikelyLooiRobot(device, robotName)) return;
          devices.set(device.id, device);
          if (mode === "first-match") finish();
        }).catch(finish);
      } catch (error) { finish(error); }
    });
  } finally {
    try { await manager.stopDeviceScan(); } catch { /* Native scan may already have ended. */ }
    scanningManagers.delete(manager);
  }
  assertBluetoothOperationActive(signal);
  return result;
}

function bluetoothStateError(state: State): Error | undefined {
  if (state === State.Unauthorized) return new Error("Bluetooth permission is denied; allow access in Settings");
  if (state === State.Unsupported) return new Error("Bluetooth is not supported on this device");
}

async function waitForManagerPoweredOn(manager: BleManager, timeoutMs: number, signal: AbortSignal): Promise<void> {
  assertBluetoothOperationActive(signal);
  const currentState = await manager.state();
  assertBluetoothOperationActive(signal);
  const error = bluetoothStateError(currentState);
  if (error) throw error;
  if (currentState === State.PoweredOn) return;

  if (Platform.OS === "android" && currentState === State.PoweredOff) {
    await manager.enable().catch(() => {});
    assertBluetoothOperationActive(signal);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: Subscription | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.remove();
      signal.removeEventListener("abort", cancelled);
      if (error) reject(error); else resolve();
    };
    const cancelled = () => finish(new Error("LOOI Bluetooth operation cancelled"));
    signal.addEventListener("abort", cancelled, { once: true });
    const timeout = setTimeout(() => {
      finish(new Error(`Bluetooth did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    subscription = manager.onStateChange((nextState) => {
      const error = bluetoothStateError(nextState);
      if (error || nextState === State.PoweredOn) finish(error);
    }, true);
    if (settled) subscription.remove();
  });
}

function findCharacteristicKey(uuid: string): LooiCharacteristicKey | null {
  const normalized = uuid.toLowerCase();
  for (const [key, expected] of Object.entries(CHARACTERISTIC_UUIDS) as Array<[LooiCharacteristicKey, string]>) {
    if (normalized === expected.toLowerCase() || shortUuid(normalized) === shortUuid(expected)) {
      return key;
    }
  }
  return null;
}

function shortUuid(uuid: string): string {
  const normalized = uuid.toLowerCase();
  const fullMatch = normalized.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/);
  return fullMatch?.[1] ?? normalized;
}

function isLikelyLooiRobot(device: Device, robotName: string): boolean {
  const advertisedName = robotAdvertisedName(device);
  if (advertisedName === robotName) return true;
  if (advertisedName.toLowerCase().includes("looi")) return true;
  return Boolean(device.serviceUUIDs?.some((uuid) => uuid.toLowerCase() === LOOI_SERVICE_UUID));
}

function robotAdvertisedName(device: Device): string {
  return device.name?.trim() || device.localName?.trim() || "";
}

function toScannedRobot(device: Device): ScannedLooiRobot {
  return {
    id: device.id,
    name: robotAdvertisedName(device) || DEFAULT_ROBOT_NAME,
    rssi: device.rssi ?? null,
    serviceUUIDs: device.serviceUUIDs ?? [],
  };
}

function compareScannedRobots(left: ScannedLooiRobot, right: ScannedLooiRobot): number {
  return (right.rssi ?? -999) - (left.rssi ?? -999);
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = new Map(Array.from(BASE64_ALPHABET, (char, index) => [char, index]));

function bytesToBase64(bytes: Uint8Array): string {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triplet = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[triplet & 0x3f] : "=";
  }

  return output;
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "");
  const bytes: number[] = [];

  for (let index = 0; index < clean.length; index += 4) {
    const first = BASE64_LOOKUP.get(clean[index]) ?? 0;
    const second = BASE64_LOOKUP.get(clean[index + 1]) ?? 0;
    const third = BASE64_LOOKUP.get(clean[index + 2]) ?? 0;
    const fourth = BASE64_LOOKUP.get(clean[index + 3]) ?? 0;
    const triplet = (first << 18) | (second << 12) | (third << 6) | fourth;

    bytes.push((triplet >> 16) & 0xff);
    if (index + 2 < clean.length) bytes.push((triplet >> 8) & 0xff);
    if (index + 3 < clean.length) bytes.push(triplet & 0xff);
  }

  return new Uint8Array(bytes);
}
