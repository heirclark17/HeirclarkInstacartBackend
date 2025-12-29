// src/services/memoryCleanup.ts

/**
 * Memory cleanup service for in-memory Maps.
 * Provides TTL-based cleanup to prevent unbounded memory growth.
 */

export interface CleanupOptions {
  ttlMs: number;           // Time-to-live in milliseconds
  intervalMs?: number;     // Cleanup interval (default: ttlMs / 2)
  maxEntries?: number;     // Maximum entries before forced cleanup
  onCleanup?: (removed: number) => void;  // Callback after cleanup
}

export interface CleanableEntry {
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
  receivedAt?: number;
}

/**
 * Create a Map with automatic TTL-based cleanup.
 */
export function createCleanableMap<K, V extends CleanableEntry>(
  options: CleanupOptions
): Map<K, V> & { destroy: () => void; cleanup: () => number } {
  const {
    ttlMs,
    intervalMs = ttlMs / 2,
    maxEntries = 10000,
    onCleanup,
  } = options;

  const map = new Map<K, V>();
  let cleanupInterval: NodeJS.Timeout | null = null;

  const cleanup = (): number => {
    const now = Date.now();
    let removed = 0;

    for (const [key, value] of map.entries()) {
      const timestamp = value.expiresAt ?? value.lastSeenAt ?? value.createdAt ?? value.receivedAt ?? 0;
      const age = now - timestamp;

      // Check expiration or TTL
      if (value.expiresAt && value.expiresAt < now) {
        map.delete(key);
        removed++;
      } else if (age > ttlMs) {
        map.delete(key);
        removed++;
      }
    }

    // Force cleanup if over max entries (remove oldest)
    if (map.size > maxEntries) {
      const entries = [...map.entries()].sort((a, b) => {
        const aTime = a[1].lastSeenAt ?? a[1].createdAt ?? 0;
        const bTime = b[1].lastSeenAt ?? b[1].createdAt ?? 0;
        return aTime - bTime;
      });

      const toRemove = map.size - maxEntries;
      for (let i = 0; i < toRemove; i++) {
        map.delete(entries[i][0]);
        removed++;
      }
    }

    if (removed > 0 && onCleanup) {
      onCleanup(removed);
    }

    return removed;
  };

  const destroy = (): void => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    map.clear();
  };

  // Start cleanup interval
  cleanupInterval = setInterval(cleanup, intervalMs);

  // Extend the map with our methods
  const extendedMap = map as Map<K, V> & { destroy: () => void; cleanup: () => number };
  extendedMap.destroy = destroy;
  extendedMap.cleanup = cleanup;

  return extendedMap;
}

/**
 * Create a cleanup-enabled Map for pairing tokens (15 min TTL).
 */
export function createPairingTokenMap<V extends CleanableEntry>() {
  return createCleanableMap<string, V>({
    ttlMs: 15 * 60 * 1000,  // 15 minutes
    maxEntries: 1000,
    onCleanup: (removed) => {
      if (removed > 0) {
        console.log(`[memoryCleanup] Removed ${removed} expired pairing tokens`);
      }
    },
  });
}

/**
 * Create a cleanup-enabled Map for devices (24 hour TTL based on lastSeenAt).
 */
export function createDeviceMap<V extends CleanableEntry>() {
  return createCleanableMap<string, V>({
    ttlMs: 24 * 60 * 60 * 1000,  // 24 hours
    maxEntries: 10000,
    onCleanup: (removed) => {
      if (removed > 0) {
        console.log(`[memoryCleanup] Removed ${removed} stale devices`);
      }
    },
  });
}

/**
 * Create a cleanup-enabled Map for health snapshots (1 hour TTL).
 */
export function createHealthSnapshotMap<V extends CleanableEntry>() {
  return createCleanableMap<string, V>({
    ttlMs: 60 * 60 * 1000,  // 1 hour
    maxEntries: 5000,
    onCleanup: (removed) => {
      if (removed > 0) {
        console.log(`[memoryCleanup] Removed ${removed} stale health snapshots`);
      }
    },
  });
}

/**
 * Create a cleanup-enabled Map for daily data (end of day TTL).
 */
export function createDailyDataMap<V extends CleanableEntry>() {
  return createCleanableMap<string, V>({
    ttlMs: 24 * 60 * 60 * 1000,  // 24 hours
    maxEntries: 10000,
    onCleanup: (removed) => {
      if (removed > 0) {
        console.log(`[memoryCleanup] Removed ${removed} old daily entries`);
      }
    },
  });
}

export default {
  createCleanableMap,
  createPairingTokenMap,
  createDeviceMap,
  createHealthSnapshotMap,
  createDailyDataMap,
};
