/** Serialize microphone acquisition and teardown, including requests arriving
 * while a native start is still pending. Legacy and Realtime adapters share it. */
export function createCaptureController<T>(driver: {
  start(): Promise<T>;
  stop(): Promise<T>;
  status(): Promise<T>;
}) {
  let owner: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const next = queue.then(operation);
    queue = next.catch(() => undefined);
    return next;
  }
  return {
    reserve(requester: string): Promise<void> {
      return enqueue(async () => {
        if (owner !== null && owner !== requester) throw new Error("Microphone capture is already in use");
        owner = requester;
      });
    },
    start(requester: string): Promise<T> {
      return enqueue(async () => {
        if (owner !== null && owner !== requester) throw new Error("Microphone capture is already in use");
        const status = await driver.start();
        owner = requester;
        return status;
      });
    },
    stop(requester: string): Promise<T> {
      return enqueue(async () => {
        if (owner !== requester) return driver.status();
        const status = await driver.stop();
        owner = null;
        return status;
      });
    },
  };
}
