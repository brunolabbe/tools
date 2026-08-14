import type { Clock } from "../src/lib/clock.ts";
import type { StorageLike } from "../src/lib/job-store.ts";

export interface FakeClock {
  clock: Clock;
  /** Runs every task due within `ms`, advancing `now` to each task's due time in order. */
  advance(ms: number): void;
  /** Delays passed to `schedule`, in call order. */
  readonly scheduled: readonly number[];
  readonly pending: number;
}

export function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let now = start;
  let nextId = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const scheduled: number[] = [];

  const clock: Clock = {
    schedule(fn, ms) {
      const id = nextId;
      nextId += 1;
      scheduled.push(ms);
      tasks.set(id, { at: now + ms, fn });
      return () => {
        tasks.delete(id);
      };
    },
    now: () => now,
  };

  return {
    clock,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Number.POSITIVE_INFINITY;
        for (const [id, task] of tasks) {
          if (task.at <= target && task.at < dueAt) {
            dueId = id;
            dueAt = task.at;
          }
        }
        if (dueId === null) break;
        const task = tasks.get(dueId);
        tasks.delete(dueId);
        now = dueAt;
        task?.fn();
      }
      now = target;
    },
    get scheduled() {
      return scheduled;
    },
    get pending() {
      return tasks.size;
    },
  };
}

export function createMemoryStorageStub(): StorageLike & { readonly raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
  };
}

/** Lets pending promise chains settle without touching timers. */
export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
