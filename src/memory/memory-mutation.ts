// A correction invalidates the cloud conversation's cached facts. Keep starts
// out until the old session is closed and all queued edits have committed.
let pendingMutations = 0;
let mutationQueue: Promise<unknown> = Promise.resolve();

export function isLocalMemoryMutationInProgress(): boolean {
  return pendingMutations > 0;
}

export function runLocalMemoryMutation<T>(
  prepare: () => Promise<void>,
  mutate: () => Promise<T>
): Promise<T> {
  pendingMutations += 1;
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    await prepare();
    return mutate();
  });
  mutationQueue = operation;
  return operation.finally(() => { pendingMutations -= 1; });
}
