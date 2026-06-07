import { info, warning } from "@actions/core";
import { loadContext } from "./context";
import {
  isOwnComment,
} from "./comments";
import { doPullRequestReview } from "./pull_request_reviewer";

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

  await doPullRequestReview(context, issue.number);
}
