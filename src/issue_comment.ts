import { info, warning } from "@actions/core";
import { loadContext } from "./context";
import {
  hasTriggeringCommand,
  isOwnComment,
} from "./comments";
import { doPullRequestReview } from "./pull_request_reviewer";
import config from "./config";
import { initOctokit } from "./octokit";

const IS_DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

export async function handleIssueComments() {
  const context = await loadContext();
  if (context.eventName !== "issue_comment") {
    warning("unsupported github event");
    return;
  }

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
  if (!hasTriggeringCommand(comment.body)) {
    info("ignoring comment without triggering command");
    return;
  }

  // Add rocket emoji reaction to the triggering comment
  if (!IS_DRY_RUN && comment.id) {
    try {
      const octokit = initOctokit(config.githubToken, config.githubApiUrl);
      await octokit.rest.reactions.createForIssueComment({
        ...context.repo,
        comment_id: comment.id,
        content: "rocket",
      });
    } catch (e) {
      warning(`Failed to add reaction: ${e}`);
    }
  } else if (IS_DRY_RUN && comment.id) {
    info(`[dry-run] Would add rocket reaction to comment ${comment.id}`);
  }

  const forceFullReview = comment.body?.includes("--full") ?? false;
  await doPullRequestReview(context, issue.number, forceFullReview);
}
