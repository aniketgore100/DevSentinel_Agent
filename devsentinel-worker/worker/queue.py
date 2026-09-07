import json
import sys
from typing import Optional

from upstash_redis import Redis

from .config import Config
from .models import ReviewJob

MAX_ATTEMPTS = 3

def get_redis_client(config : Config) -> Redis:
    return Redis(url=config.upstash_redis_url, token=config.upstash_redis_token)


def pop_job(redis: Redis, config: Config) -> Optional[ReviewJob]:
    raw = redis.rpop(config.queue_key)
    if raw is None:
        return None
    
    try:
        return ReviewJob.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"WARN: dropping unparseable job payload: {exc}", file=sys.stderr)
        return None

def requeue_job(redis: Redis, config: Config, job: ReviewJob) -> bool:
    if job.attempt >= MAX_ATTEMPTS:
        print(f"WARN: dropping job {job.job_id} after {job.attempt} attempts", file=sys.stderr)
        return False

    retried = job.model_copy(update={"attempt": job.attempt + 1})
    redis.lpush(config.queue_key, retried.model_dump_json())
    return True


def queue_depth(redis: Redis, config: Config) -> int:
    return redis.llen(config.queue_key)