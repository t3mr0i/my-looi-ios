export const PROVISIONAL_TOF_OBSTACLE_MM = 180;
export const TOF_NO_TARGET = 0x1fff;

export type Fed9CliffSensors = {
  frontLeft: boolean;
  frontRight: boolean;
  rearLeft: boolean;
  rearRight: boolean;
};

export type Fed9DecodedFrame =
  | { kind: "dock"; docked: boolean }
  | {
      kind: "cliff";
      rawFlags: boolean[];
      marker: boolean;
      sensors: Fed9CliffSensors;
      safe: boolean;
    }
  | { kind: "tof"; distanceMm: number | null; obstacleNear: boolean | null }
  | { kind: "unknown" };

/**
 * Conservative decoder inferred from real-device FED9 captures and the
 * controlled 2026-08-16 table-edge calibration.
 *
 * - 05 / 06: dock state (already confirmed by prior SDK behaviour)
 * - five bytes containing only 00/01: one marker/status byte followed by four
 *   downward cliff sensors in calibrated order:
 *     [marker, front-left, front-right, rear-left, rear-right]
 * - 0e XX XX: read here as a front TOF distance, uint16 little-endian, with
 *   0x1fff = no target. This reading is NOT established. Community captures
 *   (andrey-tut/LOOI-Robot, docs/FED9_TELEMETRY.md) see 0e only while the body
 *   is turned, slid or tilted and call it a motion/attitude scalar; nobody has
 *   published a test with an object in front of the robot. The value may only
 *   ever add caution: values above 0x1fff (such as the ffff those captures
 *   report) cannot be a distance under this reading and decode as unknown, so
 *   forward motion stays blocked instead of being treated as clear.
 *
 * The first binary byte is retained for diagnostics but intentionally does not
 * participate in the cliff-safe decision. Its exact semantic meaning remains
 * unknown; controlled tests only established the four directional sensors.
 */
export function decodeFed9SensorFrame(bytes: Uint8Array): Fed9DecodedFrame {
  if (bytes.length === 1 && bytes[0] === 0x05) return { kind: "dock", docked: true };
  if (bytes.length === 1 && bytes[0] === 0x06) return { kind: "dock", docked: false };

  if (bytes.length === 5 && Array.from(bytes).every((value) => value === 0 || value === 1)) {
    const rawFlags = Array.from(bytes, (value) => value === 1);
    const sensors: Fed9CliffSensors = {
      frontLeft: rawFlags[1],
      frontRight: rawFlags[2],
      rearLeft: rawFlags[3],
      rearRight: rawFlags[4],
    };
    return {
      kind: "cliff",
      rawFlags,
      marker: rawFlags[0],
      sensors,
      safe: Object.values(sensors).every(Boolean),
    };
  }

  if (bytes.length === 3 && bytes[0] === 0x0e) {
    const rawDistance = bytes[1] | (bytes[2] << 8);
    if (rawDistance > TOF_NO_TARGET) return { kind: "tof", distanceMm: null, obstacleNear: null };
    const distanceMm = rawDistance === TOF_NO_TARGET ? null : rawDistance;
    return {
      kind: "tof",
      distanceMm,
      obstacleNear: distanceMm !== null && distanceMm <= PROVISIONAL_TOF_OBSTACLE_MM,
    };
  }

  return { kind: "unknown" };
}
