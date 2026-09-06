# DevSentinel AI — Ingestion Gateway

Day 1 scope: **only** the webhook gateway. It receives GitHub `pull_request`
webhooks, verifies the signature, filters/normalises the event into a
`ReviewJob`, and pushes it to a Redis queue. No AI, no GitHub API calls, no
worker — those are later days.

GitHub gives webhooks a 10s timeout, and an AI review takes 60-90s, so this
service does no slow work in the request path: verify → filter → normalise →
enqueue → ack. Everything else happens downstream, off a queue.

## Requirements

- Node.js 20+
- An [Upstash Redis](https://upstash.com/) database (optional for Day 1 — see Dry-run mode below)

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set GITHUB_WEBHOOK_SECRET at minimum
npm run dev
```

The server starts on `PORT` (default `3000`).

## Dry-run mode

If `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are blank, the
gateway starts in **dry-run mode**: normalised jobs are logged instead of
queued, and idempotency/rate-limit checks are skipped. This is the default
for Day 1, since there's no Redis instance yet. The mode is announced on
startup and reported in `GET /health`. Day 2 only needs those two env vars
filled in — no code changes.

## Endpoints

| Method | Path              | Purpose                                            |
| ------ | ----------------- | --------------------------------------------------- |
| POST   | `/webhook/github` | GitHub webhook receiver                              |
| GET    | `/health`         | status, Redis reachability, queue depth, uptime      |
| GET    | `/`               | service name + status                                |

### `POST /webhook/github` behaviour

1. `X-Hub-Signature-256` is verified against the **raw** request body before
   anything is parsed. Mismatch → `401`.
2. `X-GitHub-Event: ping` → `200 {"pong": true}`.
3. Only `pull_request` events with `action` `opened` or `synchronize` are
   processed. Everything else (other actions, draft PRs) → `200` with an
   `"ignored"` reason.
4. Idempotency: a Redis key `seen:{repo}:{pr}:{head_sha}` is claimed with
   `SET NX EX 600`. If it already exists → `200 "duplicate"`, nothing is
   re-enqueued.
5. Rate limit: `rate:{repo}:{hourBucket}` is incremented, capped at
   `RATE_LIMIT_PER_HOUR` (default 30) per repo per hour. Over the cap → `429`.
6. Otherwise the event is normalised into a `ReviewJob` and `LPUSH`ed onto
   `pr_review_queue` (configurable via `QUEUE_KEY`) → `202` with the job body.

Unhandled errors return `500` (never `200`), so GitHub retries the delivery
instead of the job being silently lost.

## Testing locally

### Automated: `test-webhook.sh`

Fires a correctly-signed fake payload at `localhost:3000` (or `$HOST`),
using the `GITHUB_WEBHOOK_SECRET` from your environment or `.env`.

```bash
./test-webhook.sh              # expect 202 with the normalised job
./test-webhook.sh --tamper     # mutates the body after signing -> expect 401
./test-webhook.sh --ping       # expect 200 {"pong":true}
./test-webhook.sh --ignored    # action=closed -> expect 200, ignored
./test-webhook.sh --draft      # draft PR -> expect 200, ignored
```

### Manual, against a real PR: ngrok + a real GitHub webhook

1. Start the gateway: `npm run dev`.
2. In another terminal, expose it: `ngrok http 3000`. Copy the `https://...ngrok-free.app` URL it prints.
3. In the GitHub repo you want to test with, go to **Settings → Webhooks → Add webhook**:
   - **Payload URL**: `https://<your-ngrok-subdomain>.ngrok-free.app/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: the same value as `GITHUB_WEBHOOK_SECRET` in your `.env`
   - **Events**: select "Let me select individual events" → check **Pull requests** only
   - Save.
4. GitHub immediately sends a `ping` event — check the **Recent Deliveries**
   tab on the webhook settings page for a `200` response, and your gateway
   logs for `"received ping event"`.
5. Open a PR (or push a commit to an existing PR's branch) in that repo.
   You should see a `202` delivery in GitHub's Recent Deliveries, and either
   a Redis `LPUSH` or a dry-run log line in your terminal, depending on
   whether Redis env vars are configured.
6. To debug a specific delivery, GitHub's Recent Deliveries tab has a
   **Redeliver** button — useful for re-testing without opening a new PR
   (note: since idempotency keys are keyed on `head_sha`, redelivering the
   same `opened` event will return `"duplicate"` within the 10-minute TTL).

## Type checking

```bash
npm run typecheck   # tsc --noEmit
npm run build       # emit to dist/
npm start           # run the built output
```
