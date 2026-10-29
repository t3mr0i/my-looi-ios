import assert from "node:assert/strict";

/** Deterministic dependency delays; these values are never wall-clock measurements. */
export class VirtualClock {
  now = 100_000;
  nextId = 0;
  timers = new Map();
  setTimeout = (callback, delay = 0) => this.schedule(callback, delay, 0);
  clearTimeout = (id) => this.timers.delete(id);
  setInterval = (callback, delay) => this.schedule(callback, delay, delay);
  clearInterval = this.clearTimeout;
  schedule(callback, delay, interval) {
    const id = ++this.nextId;
    this.timers.set(id, { id, at: this.now + delay, callback, interval });
    return id;
  }
  globals() {
    const clock = this;
    return { performance: { now: () => clock.now },
      Date: class extends Date { static now() { return clock.now; } },
      setTimeout: this.setTimeout, clearTimeout: this.clearTimeout,
      setInterval: this.setInterval, clearInterval: this.clearInterval,
      fetch: () => { throw new Error("Live network is forbidden in the latency mock"); } };
  }
  async flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
  next() { return [...this.timers.values()].sort((a, b) => a.at - b.at || a.id - b.id)[0]; }
  async advanceTo(target) {
    assert.ok(target >= this.now, "virtual time cannot move backward");
    await this.flush();
    for (let steps = 0; this.next()?.at <= target; steps++) {
      assert.ok(steps < 10_000, "bounded timer processing");
      const timer = this.next();
      this.now = timer.at;
      this.timers.delete(timer.id);
      if (timer.interval) this.timers.set(timer.id, { ...timer, at: this.now + timer.interval });
      timer.callback();
      await this.flush();
    }
    this.now = target;
    await this.flush();
  }
  async until(predicate, maxAdvanceMs = 60_000) {
    const deadline = this.now + maxAdvanceMs;
    await this.flush();
    while (!predicate()) {
      const next = this.next();
      assert.ok(next && next.at <= deadline, "mock did not reach the expected event before its deadline");
      await this.advanceTo(next.at);
    }
  }
  delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { this.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = this.setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}
