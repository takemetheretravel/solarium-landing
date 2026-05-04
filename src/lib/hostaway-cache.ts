type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheClear(prefix?: string): number {
  let removed = 0;
  if (!prefix) {
    removed = store.size;
    store.clear();
    return removed;
  }
  Array.from(store.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed++;
    }
  });
  return removed;
}
