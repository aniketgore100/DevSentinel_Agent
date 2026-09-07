from openai import OpenAI

from .config import Config
from .models import ReviewJob

MODEL = "gpt-4o-mini"

SYSTEM_PROMPT = (
    "You are a careful senior engineer doing a first-pass review of a pull request diff. "
    "Point out real bugs, risky patterns, and missed edge cases, citing specific files and "
    "lines from the diff. Be concise. If the change looks fine, say so briefly instead of "
    "inventing issues."
)


def get_openai_client(config: Config) -> OpenAI:
    return OpenAI(api_key=config.openai_api_key)


def review_diff(client: OpenAI, job: ReviewJob, diff: str) -> str:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Pull request: {job.title}\nRepo: {job.repo}#{job.pr_number}\n\nDiff:\n{diff}",
            },
        ],
    )
    return response.choices[0].message.content
