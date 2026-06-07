import { info, warning } from "@actions/core";
import { loadContext } from "./context";
import config from "./config";
import { initOctokit } from "./octokit";
import {
  buildComment,
  getCommentThread,
  isOwnComment,
  isThreadRelevant,
} from "./comments";
import { parseFileDiff } from "./diff";
import { runReviewCommentPrompt } from "./prompts";

export async function handleIssueComments() {
  const context = await loadContext();
  if (context.eventName !== "issue_comment") {
    warning("unsupported github event");
    return;
  }

  info(`context payload: ${JSON.stringify(context.payload)}`);
  const { comment, issue, repository } = context.payload;
  if (!comment) {
    warning("`comment` is missing from payload");
    return;
  }
  if (context.payload.action !== "created") {
    warning("only consider newly created comments");
    return;
  }
  if (!issue) {
    warning("`issue` is missing from payload");
    return;
  }
  if (!repository) {
    warning("`repository` is missing from payload");
    return;
  }
  if (isOwnComment(comment.body)) {
    info("ignoring own comments");
    return;
  }

  const octokit = initOctokit(config.githubToken, config.githubApiUrl);

  const owner = repository.owner.login;
  const repo = repository.name;

  const pullRequest = await octokit.rest.pulls.get({
    owner: owner,
    repo: repo,
    pull_number: issue.number,
  })

  // Fetch comment thread
  const commentThread = await getCommentThread(octokit, {
    owner,
    repo,
    pull_number: issue.number,
    comment_id: comment.id,
  });
  if (!commentThread) {
    warning("comment thread not found");
    return;
  }

  // Check if the comment thread is relevant
  if (!isThreadRelevant(commentThread)) {
    info("comment thread is not relevant, ignoring it");
    return;
  }

  // Fetch diffs for all files
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner: owner,
    repo: repo,
    pull_number: issue.number,
  });
  let fileDiffs = files.map((file) => parseFileDiff(file, []));

  // Find the file that the comment is in
  const commentFileDiff = fileDiffs.find(
    (fileDiff) => fileDiff.filename === commentThread.file
  );
  if (!commentFileDiff) {
    warning("comment is not in any file that was changed in this PR");
    return;
  }

  // Run prompt
  const response = await runReviewCommentPrompt({
    commentThread,
    commentFileDiff,
  });

  // Submit response if action requested
  if (!response.action_requested || !response.response_comment.length) {
    info(
      "comment doesn't seem to require any action, so not submitting a response"
    );
    return;
  }

  info("action requested, submitting response");
  await octokit.rest.pulls.createReviewComment({
    owner: owner,
    repo: repo,
    pull_number: issue.number,
    commit_id: pullRequest.data.head.sha,
    path: commentThread.file,
    body: buildComment(response.response_comment),
    in_reply_to: commentThread.comments[0].id,
  });
}
