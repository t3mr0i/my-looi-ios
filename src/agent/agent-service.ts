import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { createMMKV, existsMMKV, type MMKV } from "react-native-mmkv";
import { createAgentClient } from "./agent-client";
import { createAgentService } from "./agent-service-core";
import { isRecord, normalizeAgentConnection, validateAgentQuery, validateAgentTaskId, type PendingAgentTask } from "./agent-protocol";

const CONNECTION_KEY = "looi.hermes-connection.v1";
const PENDING_KEY = "looi.hermes-pending-key.v1";
const PENDING_STORE_ID = "looi.hermes-pending.v1";
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let pendingStoragePromise: Promise<MMKV> | null = null;

function getPendingStorage(): Promise<MMKV> {
  if (!pendingStoragePromise) {
    pendingStoragePromise = (async () => {
      let key = await SecureStore.getItemAsync(PENDING_KEY);
      if (!key) {
        // Losing the key must not erase an uncertain admission and permit a
        // second task. Require recovery instead of recreating the store.
        if (existsMMKV(PENDING_STORE_ID)) throw new Error("Pending store key unavailable");
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
        key = Array.from(await Crypto.getRandomBytesAsync(32), (byte) => alphabet[byte & 63]).join("");
        await SecureStore.setItemAsync(PENDING_KEY, key, secureOptions);
      }
      return createMMKV({ id: PENDING_STORE_ID, encryptionKey: key, encryptionType: "AES-256" });
    })().catch((error) => { pendingStoragePromise = null; throw error; });
  }
  return pendingStoragePromise;
}

const service = createAgentService({
  async readConnection() {
    const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.url !== "string" || typeof value.token !== "string") throw new Error("Invalid stored connection");
    return normalizeAgentConnection(value.url, value.token);
  },
  async writeConnection(value) {
    if (value) await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(value), secureOptions);
    else await SecureStore.deleteItemAsync(CONNECTION_KEY);
  },
  async readPending(url) {
    const pendingStorage = await getPendingStorage();
    const raw = pendingStorage.getString(url);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.query !== "string" || !["en", "ru", "uk"].includes(String(value.language))) throw new Error("Invalid pending task");
    return { id: validateAgentTaskId(value.id), query: validateAgentQuery(value.query), language: value.language } as PendingAgentTask;
  },
  async writePending(url, value) {
    const pendingStorage = await getPendingStorage();
    if (value) pendingStorage.set(url, JSON.stringify(value));
    else pendingStorage.remove(url);
  },
}, createAgentClient({ fetcher: expoFetch as unknown as typeof fetch }), Crypto.randomUUID);

export const { getAgentSettings, configureAgentConnection, disconnectAgent, verifyAgentConnection, listAgentTasks, listAgentTaskPage, getAgentTask, getPendingAgentTask, submitAgentTask, retryPendingAgentTask, cancelAgentTask, deleteAgentTask } = service;
export { getAgentErrorCode } from "./agent-protocol";
