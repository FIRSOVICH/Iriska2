"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.connectRedis = connectRedis;
exports.setOnline = setOnline;
exports.setOffline = setOffline;
exports.isOnline = isOnline;
exports.getLastSeen = getLastSeen;
exports.cacheSet = cacheSet;
exports.cacheGet = cacheGet;
exports.cacheDel = cacheDel;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const mem = new Map();
function memSet(key, value, ttlSec) {
    mem.set(key, { value, expires: ttlSec ? Date.now() + ttlSec * 1000 : undefined });
}
function memGet(key) {
    const e = mem.get(key);
    if (!e)
        return null;
    if (e.expires && Date.now() > e.expires) {
        mem.delete(key);
        return null;
    }
    return e.value;
}
function memDel(key) { mem.delete(key); }
// Чистка истёкших ключей раз в минуту
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of mem) {
        if (v.expires && now > v.expires)
            mem.delete(k);
    }
}, 60000);
// ── Redis (если есть REDIS_URL) ───────────────────────────
let redisClient = null;
const useRedis = !!process.env.REDIS_URL;
async function connectRedis() {
    if (!useRedis) {
        console.log('ℹ️  Redis не настроен — используется in-memory хранилище');
        return;
    }
    try {
        const { createClient } = await Promise.resolve().then(() => __importStar(require('redis')));
        redisClient = createClient({ url: process.env.REDIS_URL });
        redisClient.on('error', (e) => console.error('Redis error:', e));
        await redisClient.connect();
        console.log('✅ Redis connected');
    }
    catch (e) {
        console.warn('⚠️  Redis недоступен, переключаюсь на in-memory:', e);
        redisClient = null;
    }
}
// ── Единый API ────────────────────────────────────────────
async function rSet(key, value, ttlSec) {
    if (redisClient?.isOpen) {
        const opts = ttlSec ? { EX: ttlSec } : {};
        await redisClient.set(key, value, opts);
    }
    else {
        memSet(key, value, ttlSec);
    }
}
async function rGet(key) {
    if (redisClient?.isOpen)
        return redisClient.get(key);
    return memGet(key);
}
async function rDel(key) {
    if (redisClient?.isOpen)
        await redisClient.del(key);
    else
        memDel(key);
}
// ── Онлайн-статусы ────────────────────────────────────────
async function setOnline(userId, socketId) {
    await rSet(`online:${userId}`, socketId, 120);
}
async function setOffline(userId) {
    await rDel(`online:${userId}`);
    await rSet(`lastseen:${userId}`, Date.now().toString());
}
async function isOnline(userId) {
    return (await rGet(`online:${userId}`)) !== null;
}
async function getLastSeen(userId) {
    const r = await rGet(`lastseen:${userId}`);
    return r ? Number(r) : null;
}
// ── Кэш ──────────────────────────────────────────────────
async function cacheSet(key, value, ttl = 60) {
    await rSet(`cache:${key}`, JSON.stringify(value), ttl);
}
async function cacheGet(key) {
    const r = await rGet(`cache:${key}`);
    return r ? JSON.parse(r) : null;
}
async function cacheDel(key) {
    await rDel(`cache:${key}`);
}
exports.redis = { set: rSet, get: rGet, del: rDel };
exports.default = exports.redis;
//# sourceMappingURL=redis.js.map