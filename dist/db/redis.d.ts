export declare function connectRedis(): Promise<void>;
declare function rSet(key: string, value: string, ttlSec?: number): Promise<void>;
declare function rGet(key: string): Promise<string | null>;
declare function rDel(key: string): Promise<void>;
export declare function setOnline(userId: string, socketId: string): Promise<void>;
export declare function setOffline(userId: string): Promise<void>;
export declare function isOnline(userId: string): Promise<boolean>;
export declare function getLastSeen(userId: string): Promise<number | null>;
export declare function cacheSet(key: string, value: unknown, ttl?: number): Promise<void>;
export declare function cacheGet<T>(key: string): Promise<T | null>;
export declare function cacheDel(key: string): Promise<void>;
export declare const redis: {
    set: typeof rSet;
    get: typeof rGet;
    del: typeof rDel;
};
export default redis;
//# sourceMappingURL=redis.d.ts.map