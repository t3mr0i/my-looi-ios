import { createMicroDuckAdapter } from "./microduck-adapter";
import { createReachyAdapter } from "./reachy-adapter";
import type { RobotCommandOptions, RobotCore } from "./types";
import type { RobotAppMediaServices } from "./app-media-services";

export type RobotProtocol = "reachy" | "microduck";
export type RobotGatewayProtocol = RobotProtocol | "universal";

/** One transport connection owns one app session. Wire formats stay in the adapters. */
export function createRobotGateway(core: RobotCore, options: {
  protocol: RobotGatewayProtocol;
  sessionId: string;
  allowApproximation?: boolean;
  media?: RobotAppMediaServices;
}) {
  const session = core.openSession({ id: options.sessionId, allowApproximation: options.allowApproximation });
  const universal = options.protocol === "universal";
  const reachy = universal || options.protocol === "reachy" ? createReachyAdapter(session, { media: options.media }) : null;
  const duck = universal || options.protocol === "microduck" ? createMicroDuckAdapter(session, {
    sound: options.media?.sound,
    videoInfo: options.media ? () => {
      const info = options.media!.videoInfo();
      return { ...info, source: info.available ? "measured" as const : "configured" as const };
    } : undefined,
  }) : null;
  const active = new Set<RobotProtocol>(universal ? [] : [options.protocol as RobotProtocol]);
  let closed = false;
  let generation = core.inspect().generation;
  const unsubscribe = core.subscribe(snapshot => {
    if (snapshot.generation === generation) return;
    generation = snapshot.generation;
    void options.media?.stop().catch(() => undefined);
  });
  const initial = (protocol: RobotProtocol): unknown[] => protocol === "reachy" ? reachy!.initialMessages() : [duck!.getStateEvent()];
  return {
    initialMessages(): unknown[] { return universal ? [] : initial(options.protocol as RobotProtocol); },
    async handleMessage(raw: unknown, meta?: RobotCommandOptions): Promise<unknown[]> {
      if (closed || session.closed) return [];
      let protocol = options.protocol as RobotProtocol;
      let message = raw;
      if (universal) {
        if (typeof message === "string") {
          try { message = JSON.parse(message); } catch { return [{ error: "Invalid robot app JSON message" }]; }
        }
        if (!message || typeof message !== "object" || Array.isArray(message)) return [{ error: "Invalid robot app message" }];
        const envelope = message as Record<string, unknown>;
        if (typeof envelope.method === "string" || envelope.jsonrpc !== undefined) protocol = "microduck";
        else if (typeof envelope.type === "string") protocol = "reachy";
        else return [{ error: "Unrecognized robot app request" }];
      }
      const startup = active.has(protocol) ? [] : initial(protocol);
      active.add(protocol);
      const reply = await (protocol === "reachy" ? reachy!.handleMessage(message, meta) : duck!.handleMessage(message, meta));
      return [...startup, ...(reply === null || reply === undefined ? [] : [reply]), ...(protocol === "reachy" ? reachy!.takeMessages() : [])];
    },
    stateMessages(): unknown[] {
      if (closed || session.closed) return [];
      return [...active].flatMap(protocol => protocol === "reachy"
        ? [...reachy!.pollMessages(), reachy!.snapshot(), ...reachy!.takeMessages()]
        : duck!.stateMessages());
    },
    inspect: () => session.inspect(),
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      // Revoke actuation immediately, independently of audio-player cleanup.
      const stopping = session.close("gateway-closed");
      await Promise.all([stopping, duck?.close(), reachy?.close(), options.media?.close()]);
    },
  };
}
