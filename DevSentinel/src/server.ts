import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { config } from "./config";
import { logger, withCorrelationId } from "./logger";
import { verifySignature } from "./verify";
import { handlePullRequestEvent } from "./webhook";
import { getQueueDepth, isRedisReachable } from "./queue";
import type { GitHubPullRequestEvent } from "./types";

declare module "http" {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function hasNumericStatus(err: unknown): err is { status: number } {
  return typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number";
}

const app = express();
const startedAt = Date.now();

app.use(helmet());

const webhookJsonParser = express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
    const signature = req.headers["x-hub-signature-256"];
    if (!verifySignature(buf, Array.isArray(signature) ? signature[0] : signature, config.githubWebhookSecret)) {
      logger.warn("signature verification failed", {
        deliveryId: req.headers["x-github-delivery"],
      });
      throw new HttpError(401, "signature verification failed");
    }
  },
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ service: "devsentinel-gateway", status: "ok" });
});

app.get(
  "/health",
  (_req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const redisOk = config.dryRun ? null : await isRedisReachable();
      const queueDepth = config.dryRun ? null : await getQueueDepth();

      res.status(200).json({
        status: "ok",
        dry_run: config.dryRun,
        redis: config.dryRun ? "disabled (dry-run)" : redisOk ? "reachable" : "unreachable",
        queue_depth: queueDepth,
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      });
    })().catch(next);
  }
);

app.post(
  "/webhook/github",
  webhookJsonParser,
  (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const deliveryId = req.header("X-GitHub-Delivery") ?? "unknown";
      const eventName = req.header("X-GitHub-Event");
      const log = withCorrelationId(deliveryId);

      if (eventName === "ping") {
        log.info("received ping event");
        res.status(200).json({ pong: true });
        return;
      }

      if (eventName !== "pull_request") {
        log.info("ignoring non pull_request event", { eventName });
        res.status(200).json({ status: "ignored", reason: `event '${eventName}' is not processed` });
        return;
      }

      const event = req.body as GitHubPullRequestEvent;
      const result = await handlePullRequestEvent(event, deliveryId);
      res.status(result.status).json(result.body);
    })().catch(next);
  }
);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ status: "not_found" });
});


app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ status: "unauthorized", reason: err.message });
    return;
  }

  if (err instanceof SyntaxError && hasNumericStatus(err)) {
    res.status(err.status).json({ status: "bad_request", reason: "malformed JSON body" });
    return;
  }

  logger.error("unhandled error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: req.path,
  });
  res.status(500).json({ status: "error", reason: "internal server error" });
});

app.listen(config.port, () => {
  logger.info("devsentinel-gateway listening", {
    port: config.port,
    dryRun: config.dryRun,
    rateLimitPerHour: config.rateLimitPerHour,
  });
  if (config.dryRun) {
    logger.warn("running in DRY-RUN mode — jobs will be logged, not pushed to Redis");
  }
});
