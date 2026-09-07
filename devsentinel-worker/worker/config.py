import os 
import sys
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


REQUIRED_VARS = [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "OPENAI_API_KEY",
    "GITHUB_TOKEN"
]

@dataclass(frozen=True)
class Config:
    upstash_redis_url:str
    upstash_redis_token:str
    openai_api_key:str
    github_token:str
    poll_interval_seconds:int
    queue_key:str

def load_config() -> Config:
    missing = [key for key in REQUIRED_VARS if not os.environ.get(key, "").strip()]
    if missing:
        print(f"FATAL: missing required environment variables: {missing}", file=sys.stderr)
        sys.exit(1)

    return Config(
        upstash_redis_url=os.environ["UPSTASH_REDIS_REST_URL"].strip(),
        upstash_redis_token=os.environ["UPSTASH_REDIS_REST_TOKEN"].strip(),
        openai_api_key=os.environ["OPENAI_API_KEY"].strip(),
        github_token=os.environ["GITHUB_TOKEN"].strip(),
        poll_interval_seconds=int(os.environ.get("POLL_INTERVAL_SECONDS", "5")),
        queue_key=os.environ.get("QUEUE_KEY", "pr_review_queue"),
    )

