/** Minimal shape of the fields we actually read from a GitHub pull_request webhook payload. */

export interface GitHubUser {
  login: string;
}

export interface GitHubRepository {
  full_name: string;
  private: boolean;
}

export interface GitHubCommitRef {
  sha: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  draft: boolean;
  diff_url: string;
  user: GitHubUser;
  head: GitHubCommitRef;
  base: GitHubCommitRef;
}

export interface GitHubPullRequestEvent {
  action: string;
  number: number;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  installation?: { id: number };
}

export interface GitHubPingEvent {
  zen: string;
  hook_id: number;
}

export type ReviewAction = "opened" | "synchronize";

export interface ReviewJob {
  job_id: string;
  repo: string;
  pr_number: number;
  action: ReviewAction;
  title: string;
  head_sha: string;
  base_sha: string;
  diff_url: string;
  author: string;
  is_private: boolean;
  installation_id: number | null;
  enqueued_at: string;
  attempt: number;
}
