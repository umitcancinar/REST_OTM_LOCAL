"use strict";
// ==========================================
// Redis Client
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
exports.connectRedis = connectRedis;
exports.disconnectRedis = disconnectRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
const logger_1 = require("../utils/logger");
let redis = null;
function getRedis() {
    if (!redis) {
        redis = new ioredis_1.default(env_1.env.REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            lazyConnect: true,
        });
        redis.on('connect', () => {
            logger_1.logger.info('✅ Redis connected');
        });
        redis.on('error', (err) => {
            logger_1.logger.error('❌ Redis error:', err.message);
        });
    }
    return redis;
}
async function connectRedis() {
    try {
        const client = getRedis();
        await client.connect();
    }
    catch (error) {
        logger_1.logger.warn('⚠️  Redis connection failed, continuing without cache:', error);
    }
}
async function disconnectRedis() {
    if (redis) {
        await redis.quit();
        redis = null;
    }
}
//# sourceMappingURL=redis.js.map