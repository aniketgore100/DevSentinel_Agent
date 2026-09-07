



from typing import Literal, Optional
from pydantic import BaseModel

ReviewAction = Literal["opened", "synchronize"]

class ReviewJob(BaseModel):
    job_id :str
    repo : str
    pr_number :int
    action : ReviewAction
    title : str
    head_sha : str
    base_sha : str
    diff_url : str
    author : str
    is_private : bool
    installation_id : Optional[int] = None
    enqueued_at : str
    attempt : int = 1