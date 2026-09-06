import "dotenv/config";

interface Config {
  port: number;
  githubWebhookSecret: string;
  upstashRedisUrl: string;
  upstashRedisToken: string;
  dryRun: boolean;
  rateLimitPerHour: number;
  idempotencyTtlSeconds: number;
  queueKey: string;
}

const REQUIRED_VARS = ["GITHUB_WEBHOOK_SECRET"] as const;

function loadConfig(): Config {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    console.error(
      JSON.stringify({
        level: "fatal",
        msg: "Missing required environment variables, refusing to start",
        missing,
      })
    );
    process.exit(1);
  }

  const upstashRedisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const upstashRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";

  return {
    port: Number(process.env.PORT ?? 3000),
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET!.trim(),
    upstashRedisUrl,
    upstashRedisToken,
    dryRun: !upstashRedisUrl || !upstashRedisToken,
    rateLimitPerHour: Number(process.env.RATE_LIMIT_PER_HOUR ?? 30),
    idempotencyTtlSeconds: Number(process.env.IDEMPOTENCY_TTL_SECONDS ?? 600),
    queueKey: process.env.QUEUE_KEY ?? "pr_review_queue",
  };
}

export const config = loadConfig();
