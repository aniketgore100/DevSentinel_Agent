import sys
from typing import Optional

import requests
from github import Auth, Github
from github.PullRequest import PullRequest

from .config import Config
from .models import ReviewJob

DIFF_MEDIA_TYPE = "application/vnd.github.v3.diff"


def get_github_client(config: Config) -> Github:
    return Github(auth=Auth.Token(config.github_token))


def fetch_diff(config: Config, job: ReviewJob) -> str:
    response = requests.get(
        job.diff_url,
        headers={
            "Authorization": f"Bearer {config.github_token}",
            "Accept": DIFF_MEDIA_TYPE,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.text


def get_pull_request(client: Github, job: ReviewJob) -> PullRequest:
    repo = client.get_repo(job.repo)
    return repo.get_pull(job.pr_number)


def post_review(client: Github, job: ReviewJob, review_body: str) -> Optional[str]:
    pull = get_pull_request(client, job)

    if pull.head.sha != job.head_sha:
        print(
            f"INFO: skipping stale review for {job.repo}#{job.pr_number}: "
            f"head moved from {job.head_sha} to {pull.head.sha}",
            file=sys.stderr,
        )
        return None

    review = pull.create_review(body=review_body, event="COMMENT")
    return review.html_url
