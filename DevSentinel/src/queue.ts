import { Redis } from "@upstash/redis";
import { config } from "./config";
import { logger } from "./logger";
import type { ReviewJob } from "./types";

const redis = config.dryRun
  ? null
  : new Redis({ url: config.upstashRedisUrl, token: config.upstashRedisToken });

if (config.dryRun) {
  logger.warn("Starting in DRY-RUN mode: UPSTASH_REDIS_REST_URL/TOKEN not set — jobs will be logged, not queued");
}

export type IdempotencyResult = "new" | "duplicate";
export type RateLimitResult = "ok" | "exceeded";
function hourBucket(date: Date): string {
  return date.toISOString().slice(0, 13);
}





export async function claimIdempotency(repo: string, prNumber: number, headSha: string): Promise<IdempotencyResult> {
  const key = `seen:${repo}:${prNumber}:${headSha}`;
  if (!redis) {
    logger.info("dry-run: skipping idempotency check", { key });
    return "new";
  }
  const result = await redis.set(key, "1", { nx: true, ex: config.idempotencyTtlSeconds });
  return result === "OK" ? "new" : "duplicate";
}




export async function checkRateLimit(repo: string): Promise<RateLimitResult> {
  const key = `rate:${repo}:${hourBucket(new Date())}`;
  if (!redis) {
    logger.info("dry-run: skipping rate limit check", { key });
    return "ok";
  }
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 3600);
  }
  return count > config.rateLimitPerHour ? "exceeded" : "ok";
}




export async function enqueueJob(job: ReviewJob): Promise<void> {
  if (!redis) {
    logger.info("dry-run: job not queued, logging instead", { job });
    return;
  }
  console.log(job);

  await redis.lpush(config.queueKey, JSON.stringify(job));
}



export async function getQueueDepth(): Promise<number | null> {
  if (!redis) {
    return null;
  }
  return redis.llen(config.queueKey);
}




export async function isRedisReachable(): Promise<boolean> {
  if (!redis) {
    return false;
  }
  try {
    await redis.ping();
    return true;
  } catch (err) {
    logger.error("redis ping failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
