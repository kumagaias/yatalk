import assert from "node:assert/strict";
import test from "node:test";
import { createSerialMutationQueue } from "../../src/lib/serial-mutation-queue.js";

test("serial mutation queue prevents overlap and continues after a rejected operation", async () => {
  const queue = createSerialMutationQueue();
  const events: string[] = [];
  let active = 0;
  let maximumActive = 0;
  let releaseFirst: (() => void) | undefined;
  const first = queue.run(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    events.push("first:start");
    await new Promise<void>((resolve) => { releaseFirst = resolve; });
    events.push("first:end");
    active -= 1;
    return 1;
  });
  const rejected = queue.run(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    events.push("rejected:start");
    active -= 1;
    throw new Error("expected failure");
  });
  const next = queue.run(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    events.push("next:start");
    active -= 1;
    return 3;
  });

  assert.equal(queue.isBusy(), true);
  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst?.();

  assert.equal(await first, 1);
  await assert.rejects(rejected, /expected failure/);
  assert.equal(await next, 3);
  assert.equal(maximumActive, 1);
  assert.deepEqual(events, ["first:start", "first:end", "rejected:start", "next:start"]);
  assert.equal(queue.isBusy(), false);
});
