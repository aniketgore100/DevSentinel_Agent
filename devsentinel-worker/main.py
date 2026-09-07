import sys
import time

import openai
import requests
from github import GithubException

from worker.config import load_config
from worker.github_client import fetch_diff, get_github_client, post_review
from worker.queue import get_redis_client, pop_job, requeue_job
from worker.reviewer import get_openai_client, review_diff


def main() -> None:
    config = load_config()
    redis = get_redis_client(config)
    openai_client = get_openai_client(config)
    github_client = get_github_client(config)

    print(
        f"worker started: polling '{config.queue_key}' every {config.poll_interval_seconds}s",
        file=sys.stderr,
    )

    while True:
        job = pop_job(redis, config)

        if job is None:
            time.sleep(config.poll_interval_seconds)
            continue

        print(f"picked up job {job.job_id}: {job.repo}#{job.pr_number} ({job.action}), attempt {job.attempt}")

        try:
            diff = fetch_diff(config, job)
            print(diff)
        except requests.HTTPError as exc:
            print(f"ERROR: failed to fetch diff for {job.repo}#{job.pr_number}: {exc}", file=sys.stderr)
            requeue_job(redis, config, job)
            continue

        try:
            review = review_diff(openai_client, job, diff)
            print(f"\n--- review for {job.repo}#{job.pr_number} ---\n{review}\n")
        except openai.OpenAIError as exc:
            print(f"ERROR: failed to review {job.repo}#{job.pr_number}: {exc}", file=sys.stderr)
            requeue_job(redis, config, job)
            continue

        try:
            review_url = post_review(github_client, job, review)
            if review_url:
                print(f"posted review: {review_url}")
        except GithubException as exc:
            print(f"ERROR: failed to post review for {job.repo}#{job.pr_number}: {exc}", file=sys.stderr)
            requeue_job(redis, config, job)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("worker stopped", file=sys.stderr)
