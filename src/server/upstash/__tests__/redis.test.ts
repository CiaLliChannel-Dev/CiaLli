import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RedisConstructorConfig = {
    url?: string;
    token?: string;
    automaticDeserialization?: boolean;
};

const redisConstructorMock = vi.fn();

class MockRedis {
    readonly config: RedisConstructorConfig;

    constructor(config: RedisConstructorConfig) {
        this.config = config;
        redisConstructorMock(config);
    }
}

vi.mock("@upstash/redis", () => ({
    Redis: MockRedis,
}));

const originalUrl = process.env.KV_REST_API_URL;
const originalToken = process.env.KV_REST_API_TOKEN;

function resetKvEnv(): void {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    redisConstructorMock.mockReset();
    resetKvEnv();
});

afterEach(() => {
    if (originalUrl === undefined) {
        delete process.env.KV_REST_API_URL;
    } else {
        process.env.KV_REST_API_URL = originalUrl;
    }

    if (originalToken === undefined) {
        delete process.env.KV_REST_API_TOKEN;
    } else {
        process.env.KV_REST_API_TOKEN = originalToken;
    }
});

describe("server/upstash/redis", () => {
    it("缺失配置时返回 null 且不创建客户端", async () => {
        const { getUpstashRedisClient, getUpstashRedisConfig } =
            await import("@/server/upstash/redis");

        expect(getUpstashRedisConfig()).toBeNull();
        expect(getUpstashRedisClient()).toBeNull();
        expect(getUpstashRedisClient({ automaticDeserialization: false })).toBe(
            null,
        );
        expect(redisConstructorMock).not.toHaveBeenCalled();
    });

    it("按模式缓存单例，并为原始字符串模式禁用自动反序列化", async () => {
        process.env.KV_REST_API_URL = "https://redis.test";
        process.env.KV_REST_API_TOKEN = "redis-token";

        const { getUpstashRedisClient } =
            await import("@/server/upstash/redis");

        const defaultClient = getUpstashRedisClient();
        const sameDefaultClient = getUpstashRedisClient();
        const rawClient = getUpstashRedisClient({
            automaticDeserialization: false,
        });
        const sameRawClient = getUpstashRedisClient({
            automaticDeserialization: false,
        });

        expect(defaultClient).toBe(sameDefaultClient);
        expect(rawClient).toBe(sameRawClient);
        expect(rawClient).not.toBe(defaultClient);
        expect(redisConstructorMock).toHaveBeenCalledTimes(2);
        expect(redisConstructorMock.mock.calls[0]?.[0]).toEqual({
            url: "https://redis.test",
            token: "redis-token",
        });
        expect(redisConstructorMock.mock.calls[1]?.[0]).toEqual({
            url: "https://redis.test",
            token: "redis-token",
            automaticDeserialization: false,
        });
    });
});
