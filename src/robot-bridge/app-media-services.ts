import type { AppSoundService } from "./app-sounds";
import type { RobotAudioGainDevice, RobotAudioGainStatus, RobotMediaBroker, RobotMediaRequest, RobotVideoInfo } from "./media-broker";

/** Session-scoped media operations shared by both wire adapters. The broker
 * owns capture and route consent; these services never acquire extra devices. */
export type RobotAppMediaServices = {
  videoInfo(): RobotVideoInfo;
  audio: {
    getGain(device: RobotAudioGainDevice): Promise<RobotAudioGainStatus>;
    setGain(device: RobotAudioGainDevice, percent: number): Promise<RobotAudioGainStatus>;
  };
  sound: AppSoundService;
  stop(): Promise<void>;
  close(): Promise<void>;
};

export function createRobotAppMediaServices(options: {
  owner: string;
  request: RobotMediaRequest;
  broker: () => RobotMediaBroker | null;
  createSounds: () => AppSoundService | Promise<AppSoundService>;
  isCurrent?: () => boolean;
}): RobotAppMediaServices {
  let closed = false;
  let generation = 0;
  let sounds: Promise<AppSoundService> | null = null;
  let stopBarrier = Promise.resolve();
  const request = { ...options.request };
  const current = (turn = generation) => !closed && turn === generation && (options.isCurrent?.() ?? true);

  async function authorize(device: RobotAudioGainDevice, turn: number): Promise<RobotMediaBroker> {
    const flag = device === "speaker" ? request.speaker : request.microphone;
    if (!current(turn) || !flag) throw new Error(`Robot app ${device} is not enabled for this session`);
    const broker = options.broker();
    if (!broker) throw new Error("Robot app media is not active");
    const status = await broker.inspect();
    if (!current(turn) || status.owner !== options.owner || status.phase !== "active" || !status.request?.[device]) {
      throw new Error("Robot app media session has ended");
    }
    return broker;
  }

  function stop(): Promise<void> {
    generation += 1;
    const previous = sounds;
    sounds = null;
    // A late native player factory belongs to the old generation and must be
    // stopped before another player can start. Core STOP never waits on this.
    stopBarrier = Promise.all([stopBarrier, previous?.then(player => player.stop()).catch(() => undefined)]).then(() => undefined);
    return stopBarrier;
  }

  return {
    videoInfo() {
      if (current() && request.camera) {
        const broker = options.broker();
        if (broker) return broker.getVideoInfo(options.owner);
      }
      return { width: null, height: null, rotate: 0, available: false, source: "unavailable" };
    },
    audio: {
      async getGain(device) {
        const broker = await authorize(device, generation);
        return broker.getAudioGain(device);
      },
      async setGain(device, percent) {
        const broker = await authorize(device, generation);
        return broker.setAudioGain(device, percent);
      },
    },
    sound: {
      async play(name, playOptions = {}) {
        if (playOptions.hold === false && name === "wheee") {
          await stop();
          return { accepted: true };
        }
        const turn = generation;
        try {
          if (playOptions.signal?.aborted) return { accepted: false, reason: "cancelled" };
          await authorize("speaker", turn);
          await stopBarrier;
          if (!current(turn) || playOptions.signal?.aborted) return { accepted: false, reason: "cancelled" };
          sounds ??= Promise.resolve().then(options.createSounds);
          const player = await sounds;
          if (!current(turn) || playOptions.signal?.aborted) return { accepted: false, reason: "cancelled" };
          return await player.play(name, playOptions);
        } catch (error) {
          return { accepted: false, reason: error instanceof Error ? error.message : "Sound playback could not start" };
        }
      },
      stop,
    },
    stop,
    async close() { closed = true; await stop(); },
  };
}
