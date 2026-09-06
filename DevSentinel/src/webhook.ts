import { claimIdempotency, checkRateLimit, enqueueJob } from "./queue";
import { withCorrelationId } from "./logger";
import type { GitHubPullRequestEvent, ReviewAction, ReviewJob } from "./types";

const PROCESSED_ACTIONS: ReadonlySet<string> = new Set<ReviewAction>(["opened", "synchronize"]);

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function isProcessedAction(action: string): action is ReviewAction {
  return PROCESSED_ACTIONS.has(action);
}

function normalise(event: GitHubPullRequestEvent, jobId: string): ReviewJob {
  const pr = event.pull_request;
  return {
    job_id: jobId,
    repo: event.repository.full_name,
    pr_number: pr.number,
    action: event.action as ReviewAction,
    title: pr.title,
    head_sha: pr.head.sha,
    base_sha: pr.base.sha,
    diff_url: pr.diff_url,
    author: pr.user.login,
    is_private: event.repository.private,
    installation_id: event.installation?.id ?? null,
    enqueued_at: new Date().toISOString(),
    attempt: 1,
  };
}


export async function handlePullRequestEvent(event: GitHubPullRequestEvent, deliveryId: string): Promise<WebhookResult> {
  const log = withCorrelationId(deliveryId);

  if (!isProcessedAction(event.action)) {
    log.info("ignoring event: unhandled action", { action: event.action });
    return { status: 200, body: { status: "ignored", reason: `action '${event.action}' is not processed` } };
  }

  if (event.pull_request.draft) {
    log.info("ignoring event: draft PR", { repo: event.repository.full_name, pr: event.pull_request.number });
    return { status: 200, body: { status: "ignored", reason: "draft pull requests are not reviewed" } };
  }

  const repo = event.repository.full_name;
  const prNumber = event.pull_request.number;
  const headSha = event.pull_request.head.sha;

  const rateLimit = await checkRateLimit(repo);
  if (rateLimit === "exceeded") {
    log.warn("rate limit exceeded", { repo });
    return { status: 429, body: { status: "rate_limited", reason: "hourly review limit exceeded for this repo" } };
  }

  const idempotency = await claimIdempotency(repo, prNumber, headSha);
  if (idempotency === "duplicate") {
    log.info("duplicate delivery, skipping enqueue", { repo, pr: prNumber, head_sha: headSha });
    return { status: 200, body: { status: "duplicate", reason: "this head commit has already been queued for review" } };
  }

  const job = normalise(event, deliveryId);
  await enqueueJob(job);

  log.info("job enqueued", { repo, pr: prNumber, head_sha: headSha });
  return { status: 202, body: { status: "queued", job } };
}
