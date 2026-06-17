import dotenv from 'dotenv';
dotenv.config();

/**
 * Redis с in-memory fallback.
 * Если REDIS_URL не задан — работает через Map (онлайн-статусы в памяти).
 * Для первых пользователей этого достаточно: статусы сбрасываются при
 * перезапуске сервера, но Socket.io всё равно переподключается.
 */

// ── In-memory store (fallback) ────────────────────────────
interface MemEntry { value: string; expires?: number; }
const mem = new Map<string, MemEntry>();

function memSet(key: string, value: string, ttlSec?: number) {
  mem.set(key, { value, expires: ttlSec ? Date.now() + ttlSec * 1000 : undefined });
}
function memGet(key: string): string | null {
  const e = mem.get(key);
  if (!e) return null;
  if (e.expires && Date.now() > e.expires) { mem.delete(key); return null; }
  return e.value;
}
function memDel(key: string) { mem.delete(key); }

// Чистка истёкших ключей раз в минуту
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of mem) {
    if (v.expires && now > v.expires) mem.delete(k);
  }
}, 60_000);

// ── Redis (если есть REDIS_URL) ───────────────────────────
let redisClient: any = null;
const useRedis = !!process.env.REDIS_URL;

export async function connectRedis() {
  if (!useRedis) {
    console.log('ℹ️  Redis не настроен — используется in-memory хранилище');
    return;
  }
  try {
    const { createClient } = await import('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (e: Error) => console.error('Redis error:', e));
    await redisClient.connect();
    console.log('✅ Redis connected');
  } catch (e) {
    console.warn('⚠️  Redis недоступен, переключаюсь на in-memory:', e);
    redisClient = null;
  }
}

// ── Единый API ────────────────────────────────────────────
async function rSet(key: string, value: string, ttlSec?: number) {
  if (redisClient?.isOpen) {
    const opts = ttlSec ? { EX: ttlSec } : {};
    await redisClient.set(key, value, opts);
  } else {
    memSet(key, value, ttlSec);
  }
}
async function rGet(key: string): Promise<string | null> {
  if (redisClient?.isOpen) return redisClient.get(key);
  return memGet(key);
}
async function rDel(key: string) {
  if (redisClient?.isOpen) await redisClient.del(key);
  else memDel(key);
}

// ── Онлайн-статусы ────────────────────────────────────────
export async function setOnline(userId: string, socketId: string) {
  await rSet(`online:${userId}`, socketId, 120);
}
export async function setOffline(userId: string) {
  await rDel(`online:${userId}`);
  await rSet(`lastseen:${userId}`, Date.now().toString());
}
export async function isOnline(userId: string): Promise<boolean> {
  return (await rGet(`online:${userId}`)) !== null;
}
export async function getLastSeen(userId: string): Promise<number | null> {
  const r = await rGet(`lastseen:${userId}`);
  return r ? Number(r) : null;
}

// ── Кэш ──────────────────────────────────────────────────
export async function cacheSet(key: string, value: unknown, ttl = 60) {
  await rSet(`cache:${key}`, JSON.stringify(value), ttl);
}
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = await rGet(`cache:${key}`);
  return r ? JSON.parse(r) : null;
}
export async function cacheDel(key: string) {
  await rDel(`cache:${key}`);
}

export const redis = { set: rSet, get: rGet, del: rDel };
export default redis;
