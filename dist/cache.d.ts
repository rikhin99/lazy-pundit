export interface CacheEntry {
    body: Uint8Array;
    fetchedAt: Date;
}
/** Reads a cache entry, or undefined if it's missing or unreadable. */
export declare function readCacheEntry(cacheDir: string, name: string): Promise<CacheEntry | undefined>;
/** Writes a cache entry: the payload first, then its fetch time, each atomically. */
export declare function writeCacheEntry(cacheDir: string, name: string, entry: CacheEntry): Promise<void>;
