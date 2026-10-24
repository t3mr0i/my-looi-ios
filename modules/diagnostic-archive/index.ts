import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

export type DiagnosticArchiveResult = {
  outputUri: string;
  entries: number;
  uncompressedBytes: number;
};

export type DiagnosticPerformanceSnapshot = {
  platform?: "ios" | "android";
  pid: number;
  elapsedRealtimeMs: number;
  pssKb: number | null;
  rssKb: number | null;
  javaHeapUsedBytes: number | null;
  javaHeapTotalBytes: number | null;
  javaHeapMaxBytes: number | null;
  nativeHeapBytes: number | null;
  systemAvailMemBytes: number | null;
  systemTotalMemBytes: number;
  systemLowMemory: boolean | null;
  systemLowMemoryThresholdBytes: number | null;
  thermalState?: number;
};

export type DiagnosticProcessExitReason = {
  reason: number;
  reasonName: string;
  status: number;
  importance: number;
  pssKb: number;
  rssKb: number;
  timestampMs: number;
  description: string;
};

declare class DiagnosticArchiveNativeModule extends NativeModule {
  createZip(sourceDirectoryUri: string, outputFileUri: string): Promise<DiagnosticArchiveResult>;
  getPerformanceSnapshot(): Promise<DiagnosticPerformanceSnapshot>;
  getPreviousProcessExitReasons(maxCount: number): Promise<DiagnosticProcessExitReason[]>;
}

let cached: DiagnosticArchiveNativeModule | null = null;

function getModule(): DiagnosticArchiveNativeModule {
  if (Platform.OS === "web") throw new Error("Native diagnostics require an iOS or Android runtime");
  cached ??= requireNativeModule<DiagnosticArchiveNativeModule>("DiagnosticArchive");
  return cached;
}

export async function createDiagnosticZip(
  sourceDirectoryUri: string,
  outputFileUri: string
): Promise<DiagnosticArchiveResult> {
  return getModule().createZip(sourceDirectoryUri, outputFileUri);
}

export async function getDiagnosticPerformanceSnapshot(): Promise<DiagnosticPerformanceSnapshot | null> {
  if (Platform.OS === "web") return null;
  return getModule().getPerformanceSnapshot();
}

export async function getPreviousProcessExitReasons(maxCount = 3): Promise<DiagnosticProcessExitReason[]> {
  if (Platform.OS !== "android") return [];
  return getModule().getPreviousProcessExitReasons(maxCount);
}
