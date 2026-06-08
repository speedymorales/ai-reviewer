import { info, warning } from "@actions/core";
import config from "./config";
import { initOctokit } from "./octokit";
import { runSummaryPrompt, AIComment, runReviewPrompt } from "./prompts";
import {
  buildLoadingMessage,
  buildReviewSummary,
  buildOverviewMessage,
  OVERVIEW_MESSAGE_SIGNATURE,
  PAYLOAD_TAG_CLOSE,
  PAYLOAD_TAG_OPEN,
} from "./messages";
import { FileDiff, parseFileDiff } from "./diff";
import { Octokit } from "@octokit/action";
import { Context } from "@actions/github/lib/context";
import { buildComment, listPullRequestCommentThreads } from "./comments";

const IS_DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

export async function doPullRequestReview(context: Context, pullRequestNumber: number) {
  const octokit = initOctokit(config.githubToken, config.githubApiUrl);

  // Get commit messages
  const { data: commits } = await octokit.rest.pulls.listCommits({
    ...context.repo,
    pull_number: pullRequestNumber,
  });
  info(`successfully fetched commit messages`);

  // Find or create overview comment with the summary
  const { data: existingComments } = await octokit.rest.issues.listComments({
    ...context.repo,
    issue_number: pullRequestNumber,
  });
  let overviewComment = existingComments.find((comment) =>
    comment.body?.includes(OVERVIEW_MESSAGE_SIGNATURE)
  );
  const isIncrementalReview = !!overviewComment;

  // Maybe fetch review comments
  const reviewCommentThreads = isIncrementalReview
    ? await listPullRequestCommentThreads(octokit, {
      ...context.repo,
      pull_number: pullRequestNumber,
    })
    : [];

  const pullRequest = await octokit.rest.pulls.get({
    ...context.repo,
    pull_number: pullRequestNumber,
  });

  // Get modified files
  const { data: files } = await octokit.rest.pulls.listFiles({
    ...context.repo,
    pull_number: pullRequestNumber,
  });
  let filesToReview = files.map((file) =>
    parseFileDiff(file, reviewCommentThreads)
  );
  info(`successfully fetched file diffs`);

  let commitsReviewed: string[] = [];
  let lastCommitReviewed: string | null = null;
  if (overviewComment) {
    info(`running incremental review`);
    try {
      const payload = JSON.parse(
        overviewComment.body
          ?.split(PAYLOAD_TAG_OPEN)[1]
          .split(PAYLOAD_TAG_CLOSE)[0] || "{}"
      );
      commitsReviewed = payload.commits;
    } catch (error) {
      warning(`error parsing overview payload: ${error}`);
    }

    // Check if there are any incremental changes
    lastCommitReviewed =
      commitsReviewed.length > 0
        ? commitsReviewed[commitsReviewed.length - 1]
        : null;
    const incrementalDiff =
      lastCommitReviewed && lastCommitReviewed != pullRequest.data.head.sha
        ? await octokit.rest.repos.compareCommits({
          ...context.repo,
          base: lastCommitReviewed,
          head: pullRequest.data.head.sha,
        })
        : null;
    if (incrementalDiff?.data?.files) {
      // If incremental review, only consider files that were modified within incremental change.
      filesToReview = filesToReview.filter((f) =>
        incrementalDiff.data.files?.some((f2) => f2.filename === f.filename)
      );
    }
  } else {
    info(`running full review`);
  }

  const commitsToReview = commitsReviewed.length
    ? commits.filter((c) => !commitsReviewed.includes(c.sha))
    : commits;
  if (commitsToReview.length === 0) {
    info(`no new commits to review`);
    return;
  }

  if (IS_DRY_RUN) {
    const body = buildLoadingMessage(
      (lastCommitReviewed ?? pullRequest.data.base.sha),
      commitsToReview,
      filesToReview
    );
    info(`DRY-RUN: would ${overviewComment ? "update" : "create"} overview loading comment`);
    console.log(body);
  } else if (overviewComment) {
    await octokit.rest.issues.updateComment({
      ...context.repo,
      comment_id: overviewComment.id,
      body: buildLoadingMessage(
        lastCommitReviewed ?? pullRequest.data.base.sha,
        commitsToReview,
        filesToReview
      ),
    });
    info(`updated existing overview comment`);
  } else {
    overviewComment = (
      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: pullRequestNumber,
        body: buildLoadingMessage(
          pullRequest.data.base.sha,
          commitsToReview,
          filesToReview
        ),
      })
    ).data;
    info(`posted new overview loading comment`);
  }

  // Generate PR summary
  const summary = await runSummaryPrompt({
    prTitle: pullRequest.data.title,
    prDescription: pullRequest.data.body || "",
    commitMessages: commits.map((commit) => commit.commit.message),
    files: files,
  });
  info(`generated pull request summary: ${summary.title}`);

  // Update PR title if @presubmitai is mentioned in the title
  if (
    pullRequest.data.title.includes("@presubmitai") ||
    pullRequest.data.title.includes("@presubmit")
  ) {
    info(`title contains mention of presubmit.ai, so generating a new title`);
    if (IS_DRY_RUN) {
      info(`DRY-RUN: would update PR title to: ${summary.title}`);
    } else {
      await octokit.rest.pulls.update({
        ...context.repo,
        pull_number: pullRequest.data.number,
        title: summary.title,
        // body: summary.description,
      });
    }
  }

  // Update overview comment with the PR overview
  const walkthroughBody = buildOverviewMessage(
    summary,
    commits.map((c) => c.sha)
  );
  if (IS_DRY_RUN) {
    info(`DRY-RUN: would update overview comment with walkthrough`);
    console.log(walkthroughBody);
  } else if (overviewComment) {
    await octokit.rest.issues.updateComment({
      ...context.repo,
      comment_id: overviewComment.id,
      body: walkthroughBody,
    });
    info(`updated overview comment with walkthrough`);
  }

  // ======= START REVIEW =======

  const review = await runReviewPrompt({
    files: filesToReview,
    prTitle: pullRequest.data.title,
    prDescription: pullRequest.data.body || "",
    prSummary: summary.description,
  });
  info(`reviewed pull request`);

  // Post review comments
  const comments = review.comments.filter(
    (c) => c.content.trim() !== "" && files.some((f) => f.filename === c.file)
  );

  if (IS_DRY_RUN) {
    info(`DRY-RUN: would submit review with ${comments.length} inline comments`);
    const finalBody = buildOverviewMessage(
      summary,
      commits.map((c) => c.sha)
    );
    console.log('=== Final Overview (dry-run) ===');
    console.log(finalBody);
    if (comments.length) {
      console.log('=== Inline Comments (dry-run) ===');
      for (const c of comments) {
        const range = c.start_line && c.end_line ? `${c.start_line}-${c.end_line}` : `${c.end_line ?? ''}`;
        console.log(`• ${c.file}:${range} ${c.label ? '[' + c.label + '] ' : ''}${c.critical ? '(critical) ' : ''}\n${c.content}\n`);
      }
    }
    return;
  }

  await submitReview(
    octokit,
    context,
    {
      number: pullRequest.data.number,
      headSha: pullRequest.data.head.sha,
    },
    comments,
    commitsToReview,
    filesToReview
  );
  info(`posted review comments`);
}

async function submitReview(
  octokit: Octokit,
  context: Context,
  pull_request: {
    number: number;
    headSha: string;
  },
  comments: AIComment[],
  commits: {
    sha: string;
    commit: {
      message: string;
    };
  }[],
  files: FileDiff[]
) {
  const submitInlineComment = async (
    file: string,
    line: number,
    content: string
  ) => {
    await octokit.pulls.createReviewComment({
      ...context.repo,
      pull_number: pull_request.number,
      commit_id: pull_request.headSha,
      path: file,
      body: buildComment(content),
      line,
    });
  };

  // Handle file comments
  const fileComments = comments.filter((c) => !c.end_line);
  if (fileComments.length > 0) {
    const responses = await Promise.allSettled(
      fileComments.map((c) => submitInlineComment(c.file, -1, c.content))
    );

    for (const response of responses) {
      if (response.status === "rejected") {
        warning(`error creating file comment: ${response.reason}`);
      }
    }
  }

  // Handle line comments
  const lineComments: AIComment[] = [];
  const skippedComments: AIComment[] = [];
  for (const comment of comments) {
    if (comment.critical || comment.label === "typo") {
      lineComments.push(comment);
    } else {
      skippedComments.push(comment);
    }
  }

  // Try to submit all comments at once
  try {
    const commentsData = lineComments.map((c) => ({
      path: c.file,
      body: buildComment(c.content),
      line: c.end_line,
      side: "RIGHT",
      start_line:
        c.start_line && c.start_line < c.end_line ? c.start_line : undefined,
      start_side:
        c.start_line && c.start_line < c.end_line ? "RIGHT" : undefined,
    }));

    const review = await octokit.pulls.createReview({
      ...context.repo,
      pull_number: pull_request.number,
      commit_id: pull_request.headSha,
      comments: commentsData,
    });

    await octokit.pulls.submitReview({
      ...context.repo,
      pull_number: pull_request.number,
      review_id: review.data.id,
      event: "COMMENT",
      body: buildReviewSummary(
        context,
        files,
        commits,
        lineComments,
        skippedComments
      ),
    });
  } catch (error) {
    warning(`error submitting review: ${error}`);

    // If submitting all comments at once fails, try submitting them one by one
    info("trying to submit comments one by one");
    await Promise.allSettled(
      lineComments.map((c) =>
        submitInlineComment(c.file, c.end_line, c.content)
      )
    );
  }
}
