export function createSerialMutationQueue() {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      pending += 1;
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result.finally(() => { pending -= 1; });
    },
    isBusy: () => pending > 0,
  };
}
