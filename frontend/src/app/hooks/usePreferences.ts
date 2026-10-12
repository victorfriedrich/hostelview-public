'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { HostelRef, WeighedAspect } from '../api';

export type Opinion = 'liked' | 'disliked';

/** 1: important, 2: top priority; aspects left out count as usual. */
export type AspectWeight = 1 | 2;

/**
 * The traveller profile: the aspects the visitor cares about most and hostels they liked or
 * disliked. Kept in this browser only.
 */
export interface Preferences {
  aspects: Partial<Record<WeighedAspect, AspectWeight>>;
  liked: HostelRef[];
  disliked: HostelRef[];
}

export const PREFERENCES_KEY = 'hostelview:preferences';
const KEY = PREFERENCES_KEY;
const EMPTY: Preferences = { aspects: {}, liked: [], disliked: [] };
const listeners = new Set<() => void>();
let current: Preferences | null = null;

const list = (x: unknown): HostelRef[] => (Array.isArray(x) ? x : []);

function read(): Preferences {
  if (current) return current;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    current = parsed && typeof parsed === 'object'
      ? { aspects: parsed.aspects ?? {}, liked: list(parsed.liked), disliked: list(parsed.disliked) }
      : EMPTY;
  } catch {
    current = EMPTY;
  }
  return current;
}

function write(next: Preferences) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePreferences() {
  const prefs = useSyncExternalStore(subscribe, read, () => EMPTY);

  const setAspect = useCallback((aspect: WeighedAspect, weight: AspectWeight | undefined) => {
    const p = read();
    const aspects = { ...p.aspects, [aspect]: weight };
    if (!weight) delete aspects[aspect];
    write({ ...p, aspects });
  }, []);

  /** Marks a hostel liked or disliked (a hostel is never both), or clears it with null. */
  const setOpinion = useCallback((hostel: HostelRef, opinion: Opinion | null) => {
    const p = read();
    const ref = { id: hostel.id, name: hostel.name, city: hostel.city };
    const without = (l: HostelRef[]) => l.filter((h) => h.id !== hostel.id);
    write({
      ...p,
      liked: opinion === 'liked' ? [...without(p.liked), ref] : without(p.liked),
      disliked: opinion === 'disliked' ? [...without(p.disliked), ref] : without(p.disliked),
    });
  }, []);

  const opinionOf = useCallback(
    (id: number): Opinion | null =>
      prefs.liked.some((h) => h.id === id) ? 'liked' : prefs.disliked.some((h) => h.id === id) ? 'disliked' : null,
    [prefs],
  );

  // Anything For you can rank by: until then the For you tab shows the setup page instead.
  const hasProfile = Object.keys(prefs.aspects).length > 0 || prefs.liked.length > 0 || prefs.disliked.length > 0;
  return { ...prefs, hasProfile, setAspect, setOpinion, opinionOf };
}
