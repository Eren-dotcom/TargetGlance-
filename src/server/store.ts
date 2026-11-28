import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One tiny key/value store shared by the glasses app, the companion and Judge Mode.
 * It is the single source of truth because the phone browser and the Even WebView are
 * different storage origins on real hardware — localStorage alone cannot sync them.
 * shortcut: last-write-wins, single user, no auth. Upgrade if this ever leaves localhost.
 */
export const STATE_KEYS = ['targets', 'book', 'alerts', 'trades', 'watchlist'] as const;
export type StateKey = (typeof STATE_KEYS)[number];
export const MAX_BODY = 64 * 1024;

export function createStore(file = process.env.TARGETGLANCE_DB ?? '.data/state.json') {
  let data: Partial<Record<StateKey, unknown>> = {};
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    data = {};
  }

  const save = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data));
    } catch (e) {
      // Disk is a durability bonus, not a dependency: the demo keeps running in memory.
      console.warn('[store] could not persist state:', (e as Error).message);
    }
  };

  return {
    get: (key: StateKey) => data[key],
    set: (key: StateKey, value: unknown) => {
      data[key] = value;
      save();
      return value;
    },
    reset: () => {
      data = {};
      save();
    },
    snapshot: () => data,
  };
}

export type Store = ReturnType<typeof createStore>;
export const isStateKey = (k: string): k is StateKey => (STATE_KEYS as readonly string[]).includes(k);
