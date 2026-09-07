# DevSentinel — Multi-Agent Pull Request Review & Automated Remediation Engine
## 1. Overview

DevSentinel is an automated code-review agent for pull requests. When a
developer opens or updates a pull request, DevSentinel notices, reviews the
changes, and leaves feedback directly on the pull request — without a human
reviewer needing to be the first set of eyes on it.

The goal is to give every pull request fast, consistent, automated feedback
the moment it's ready to be looked at, so human reviewers can spend their time
on judgment calls instead of first-pass triage.

## 2. Problem Statement

Pull requests often sit waiting for a human reviewer to have time to look at
them. Even when a reviewer is available, the first pass over a change —
spotting obvious bugs, risky patterns, missing edge cases, style
inconsistencies — is repetitive work that delays real feedback and competes
with reviewers' other responsibilities. The result is slower iteration for
the author and reviewer fatigue for the team.

## 3. Purpose / Goals

- Give every pull request an automated first-pass review, quickly, without
  waiting on a human's availability.
- Reduce the reviewing burden on the team by catching common issues before a
  human ever looks at the change.
- Never slow down or interfere with the normal pull request workflow — the
  agent is a helpful extra reviewer, not a gate.
- Be reliable: never silently miss a pull request, never review the same
  change twice, and never let one noisy repository overwhelm the system.

## 4. Who It's For

- **Developers**, who get feedback on their pull request almost immediately
  after opening or updating it, instead of waiting on a teammate.
- **Reviewers/maintainers**, who inherit a pull request that has already had
  its obvious issues flagged, so their own review can focus on intent,
  design, and judgment calls.
- **Teams**, who get a consistent baseline of review quality applied to
  every pull request, regardless of who's available to review it.

## 5. How It Works

The system is split into two stages: **noticing** a change, and **reviewing**
it. They're deliberately decoupled so that reviewing — which takes real time
to think through a change — never risks delaying or breaking the notification
step.

1. **A pull request is opened or updated.** The originating platform
   notifies DevSentinel right away.
2. **DevSentinel checks that the notification is genuine and worth acting
   on.** It confirms the notification actually came from the expected
   source, and filters out things that don't need a review — for example,
   a draft pull request, an event that isn't a meaningful change, or a
   notification about a change it has already seen and processed.
3. **DevSentinel checks it isn't being flooded.** Each repository is allowed
   a reasonable number of reviews per hour, so one very active or misbehaving
   repository can't consume all of the system's attention.
4. **The request is handed off to be reviewed in the background.**
   DevSentinel immediately confirms receipt so the originating platform
   knows the notification was received — it does not wait for the review
   itself to finish before responding.
5. **A reviewing agent picks up the work whenever it's ready.** Working
   independently of the notification step, it looks at what actually
   changed in the pull request.
6. **The agent produces a review.** It reasons about the change — looking
   for bugs, risky patterns, missed edge cases, and other issues worth
   flagging — the way a careful human reviewer would on a first pass.
7. **The review is posted back to the pull request**, visible to the author
   and team in the same place any other review would appear.

The developer sees automated, substantive feedback on their pull request
shortly after opening or updating it — every time, without needing to wait
for a person to be free.

## 6. Scope

### In scope
- Reviewing pull requests: noticing them, filtering out ones that don't
  need attention, and producing and posting a review on the ones that do.
- Guarding against duplicate reviews of the same change and against any
  single repository overwhelming the system.
- Making the system's operational health easy to check at a glance.

### Out of scope (for now)
- Reviewing anything other than pull requests (e.g. standalone comments,
  issues, discussions).
- Automatically approving, blocking, or merging a pull request based on its
  review.
- Supporting sources of pull requests beyond the primary one being
  targeted first.

## 7. Success Criteria

- Every valid pull request event is captured exactly once — no missed
  events, no duplicate reviews of the same change.
- The originating platform never experiences a slow or failed response
  from DevSentinel when a pull request event is sent.
- Every pull request that should be reviewed receives a review within a
  short, predictable amount of time after it's opened or updated.
- A single repository's activity can never exhaust the system's capacity
  to serve other repositories.
- The system's current status — whether it's healthy, backed up, or idle —
  can be checked at any time.

## 8. Non-Functional Expectations

- **Responsiveness**: acknowledging a new pull request must happen almost
  instantly, well before the platform's own patience for a response runs
  out.
- **Reliability**: a failure partway through must never result in a pull
  request being silently skipped — it should be retried rather than lost.
- **Idempotency**: seeing the same notification more than once (e.g. a
  retried delivery) must never produce more than one review.
- **Fairness**: no single repository should be able to starve others of
  review capacity.
- **Observability**: it should always be possible to tell, from the
  outside, whether the system is working normally.

## 9. Open Questions / Future Work

- What should happen when a reviewed pull request is updated again before
  the first review is even posted?
- Should authors be able to ask for a re-review on demand, rather than only
  on every update?
- Should review depth/strictness be configurable per repository or team?
- How should conflicting feedback between the automated review and a human
  reviewer be handled?
- Right now a review is a single free-text comment on the PR. Could findings
  instead be posted as line-anchored, one-click "suggested changes"? Doing
  this reliably requires the model to reference exact diff line numbers,
  which isn't guaranteed to be accurate on every finding.
- Could the reviewing agent become multi-step (e.g. fetch extra file context
  before judging a change, or run multiple passes) instead of a single LLM
  call per PR? A graph/state-machine orchestration (e.g. LangGraph) would
  only be worth the added complexity once there's real branching logic to
  manage.

## 10. Current Implementation Status

The system is split into two independent services that communicate only
through a shared Redis queue.

### `DevSentinel/` — the ingestion gateway (Node.js / TypeScript)

Fully implemented and covers PRD steps 1–4:

- Receives GitHub `pull_request` webhooks and verifies the HMAC signature
  (`X-Hub-Signature-256`) before touching the payload.
- Filters out draft PRs and any action other than `opened` / `synchronize`.
- Deduplicates by `repo:pr_number:head_sha` so a retried webhook delivery
  never produces two jobs for the same commit.
- Rate-limits reviews per repository per hour.
- Enqueues a `ReviewJob` onto Redis (Upstash) and immediately acknowledges
  the webhook — it never waits on the review itself.
- Exposes `GET /health` (queue depth, Redis reachability, uptime) and runs
  in a dry-run mode (jobs logged, not queued) when Redis credentials aren't
  configured.

### `devsentinel-worker/` — the reviewing agent (Python)

Fully implemented and covers PRD steps 5–7:

- `worker/config.py` — loads and validates required environment variables.
- `worker/models.py` — the `ReviewJob` shape, mirroring the gateway's TS type.
- `worker/queue.py` — pops jobs from Redis; on a failed diff fetch or review,
  re-queues the job (up to a fixed retry limit) instead of dropping it.
- `worker/github_client.py` — fetches the real unified diff for a PR, and
  posts the finished review back onto that PR as a review comment. Before
  posting, it checks the PR's current head SHA still matches the job's — if
  the PR moved on while the job was queued, the stale review is skipped
  rather than posted.
- `worker/reviewer.py` — sends the diff to an LLM (currently OpenAI,
  `gpt-4o-mini`) with a reviewer-style prompt and returns the findings as
  plain text.
- `main.py` — the worker loop: poll Redis → fetch diff → get a review →
  post it to the PR, with each stage's failures isolated so one bad job
  doesn't take down the whole worker process.

**Confirmed working end-to-end**: opening or updating a real pull request on
a repo wired to the webhook results in an actual review comment appearing on
that PR, posted by the account behind `GITHUB_TOKEN`, with real LLM-generated
feedback on the real diff.

### Known limitations at this stage

- Reviews are posted as a single free-text comment on the PR as a whole —
  not as line-anchored, clickable "suggested changes."
- The reviewing step is a single LLM call, not a multi-step/agentic process.
- Retry on failure re-queues up to a fixed attempt limit, then drops the job
  with a logged warning — there's no persistent dead-letter store yet.
- Local testing requires a tunnel (e.g. ngrok) in front of the gateway so
  GitHub's webhook can reach it.

## 11. Running It Locally

Two services, two `.env` files — see each folder's `.env.example`.

**Gateway** (`DevSentinel/`): needs `GITHUB_WEBHOOK_SECRET` (must match the
secret configured on the repo's webhook) and Upstash Redis credentials.

```bash
cd DevSentinel
npm install
npm run dev
```

**Worker** (`devsentinel-worker/`): needs the same Upstash Redis credentials
as the gateway (same database, so jobs actually hand off), an `OPENAI_API_KEY`,
and a `GITHUB_TOKEN` — a fine-grained personal access token scoped to the
specific repo being reviewed, with **Pull requests: Read and write**
permission.

```bash
cd devsentinel-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

With both running (and the gateway reachable from the internet via a tunnel,
registered as the repo's webhook URL), opening or pushing to a real pull
request triggers the full pipeline automatically — no manual webhook payloads
or URLs needed.
