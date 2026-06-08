import assert from "node:assert/strict";
import { before, beforeEach, describe, mock, test } from "node:test";

const mockInfo = mock.fn();
const mockWarning = mock.fn();
const mockLoadContext = mock.fn();
const mockInitOctokit = mock.fn();
const mockBuildComment = mock.fn((comment: string) => `formatted:${comment}`);
const mockGetCommentThread = mock.fn();
const mockIsOwnComment = mock.fn(() => false);
const mockIsThreadRelevant = mock.fn(() => true);
const mockRunReviewCommentPrompt = mock.fn();
const mockListFiles = mock.fn();
const mockCreateReviewComment = mock.fn();

const mockOctokit = {
  rest: {
    pulls: {
      listFiles: (...args: any[]) => mockListFiles(...args),
      createReviewComment: (...args: any[]) => mockCreateReviewComment(...args),
    },
  },
};

let handlePullRequestComment: typeof import("../pull_request_comment").handlePullRequestComment;

describe("Pull Request Comment Handler", () => {
  before(async () => {
    await mock.module("@actions/core", {
      exports: {
        info: (...args: any[]) => mockInfo(...args),
        warning: (...args: any[]) => mockWarning(...args),
      },
    });

    await mock.module("../config.ts", {
      exports: {
        default: {
          githubToken: "mock-token",
          githubApiUrl: "https://api.github.com",
          githubServerUrl: "https://github.com",
          loadInputs: () => undefined,
        },
      },
    });

    await mock.module("../context.ts", {
      exports: {
        loadContext: (...args: any[]) => mockLoadContext(...args),
      },
    });

    await mock.module("../octokit.ts", {
      exports: {
        initOctokit: (...args: any[]) => mockInitOctokit(...args),
      },
    });

    await mock.module("../comments.ts", {
      exports: {
        buildComment: (...args: any[]) => mockBuildComment(...args),
        getCommentThread: (...args: any[]) => mockGetCommentThread(...args),
        isOwnComment: (...args: any[]) => mockIsOwnComment(...args),
        isThreadRelevant: (...args: any[]) => mockIsThreadRelevant(...args),
      },
    });

    await mock.module("../prompts.ts", {
      exports: {
        runReviewCommentPrompt: (...args: any[]) => mockRunReviewCommentPrompt(...args),
      },
    });

    ({ handlePullRequestComment } = await import("../pull_request_comment.ts"));
  });
  beforeEach(() => {
    mockInfo.mock.resetCalls();
    mockWarning.mock.resetCalls();
    mockLoadContext.mock.resetCalls();
    mockLoadContext.mock.mockImplementation(async () => ({
      eventName: "pull_request_review_comment",
      repo: { owner: "test-owner", repo: "test-repo" },
      payload: {
        action: "created",
        comment: {
          id: 123,
          body: "Test comment",
          user: { login: "test-user" },
        },
        pull_request: {
          number: 456,
          head: { sha: "head-sha" },
        },
      },
    }));
    mockInitOctokit.mock.resetCalls();
    mockInitOctokit.mock.mockImplementation(() => mockOctokit);
    mockBuildComment.mock.resetCalls();
    mockBuildComment.mock.mockImplementation((comment: string) => `formatted:${comment}`);
    mockGetCommentThread.mock.resetCalls();
    mockGetCommentThread.mock.mockImplementation(async () => ({
      file: "test.ts",
      comments: [
        {
          id: 123,
          body: "Test comment",
          user: { login: "test-user" },
          path: "test.ts",
          line: 2,
          diff_hunk: "@@ -1,1 +1,2 @@\n test\n+added",
        },
      ],
    }));
    mockIsOwnComment.mock.resetCalls();
    mockIsOwnComment.mock.mockImplementation(() => false);
    mockIsThreadRelevant.mock.resetCalls();
    mockIsThreadRelevant.mock.mockImplementation(() => true);
    mockRunReviewCommentPrompt.mock.resetCalls();
    mockRunReviewCommentPrompt.mock.mockImplementation(async () => ({
      response_comment: "AI response to comment",
      action_requested: true,
    }));
    mockListFiles.mock.resetCalls();
    mockListFiles.mock.mockImplementation(async () => ({
      data: [
        {
          filename: "test.ts",
          status: "modified",
          patch: "@@ -1,1 +1,2 @@\n test\n+added",
        },
      ],
    }));
    mockCreateReviewComment.mock.resetCalls();
    mockCreateReviewComment.mock.mockImplementation(async () => ({}));
  });

  test("handles pull request comment event correctly", async () => {
    await handlePullRequestComment();

    assert.equal(mockLoadContext.mock.callCount(), 1);
    assert.equal(mockInitOctokit.mock.callCount(), 1);
    assert.equal(mockGetCommentThread.mock.callCount(), 1);
    assert.equal(mockGetCommentThread.mock.calls[0].arguments[0], mockOctokit);
    assert.deepEqual(mockGetCommentThread.mock.calls[0].arguments[1], {
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 456,
      comment_id: 123,
    });
    assert.deepEqual(mockListFiles.mock.calls[0].arguments[0], {
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 456,
    });
    assert.equal(mockRunReviewCommentPrompt.mock.callCount(), 1);
    assert.equal(mockCreateReviewComment.mock.callCount(), 1);
    assert.deepEqual(mockCreateReviewComment.mock.calls[0].arguments[0], {
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 456,
      commit_id: "head-sha",
      path: "test.ts",
      body: "formatted:AI response to comment",
      in_reply_to: 123,
    });
  });

  test("ignores own comments", async () => {
    mockIsOwnComment.mock.mockImplementation(() => true);

    await handlePullRequestComment();

    assert.equal(mockLoadContext.mock.callCount(), 1);
    assert.equal(mockInitOctokit.mock.callCount(), 0);
    assert.equal(mockGetCommentThread.mock.callCount(), 0);
    assert.equal(mockRunReviewCommentPrompt.mock.callCount(), 0);
  });

  test("ignores irrelevant comment threads", async () => {
    mockIsThreadRelevant.mock.mockImplementation(() => false);

    await handlePullRequestComment();

    assert.equal(mockLoadContext.mock.callCount(), 1);
    assert.equal(mockGetCommentThread.mock.callCount(), 1);
    assert.equal(mockListFiles.mock.callCount(), 0);
    assert.equal(mockRunReviewCommentPrompt.mock.callCount(), 0);
  });

  test("skips response when no action requested", async () => {
    mockRunReviewCommentPrompt.mock.mockImplementation(async () => ({
      response_comment: "AI response to comment",
      action_requested: false,
    }));

    await handlePullRequestComment();

    assert.equal(mockRunReviewCommentPrompt.mock.callCount(), 1);
    assert.equal(mockCreateReviewComment.mock.callCount(), 0);
  });
});
