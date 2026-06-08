import assert from "node:assert/strict";
import { before, beforeEach, describe, mock, test } from "node:test";

const mockInfo = mock.fn();
const mockWarning = mock.fn();
const mockLoadContext = mock.fn();
const mockDoPullRequestReview = mock.fn();

let handlePullRequest: typeof import("../pull_request").handlePullRequest;

describe("Pull Request Handler", () => {
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
        initOctokit: () => {
          throw new Error("initOctokit should not be called in handlePullRequest tests");
        },
      },
    });

    await mock.module("../prompts.ts", {
      exports: {
        runSummaryPrompt: async () => undefined,
        runReviewPrompt: async () => undefined,
      },
    });

    await mock.module("../pull_request_reviewer.ts", {
      exports: {
        doPullRequestReview: (...args: any[]) => mockDoPullRequestReview(...args),
      },
    });

    ({ handlePullRequest } = await import("../pull_request.ts"));
  });
  beforeEach(() => {
    mockInfo.mock.resetCalls();
    mockWarning.mock.resetCalls();
    mockLoadContext.mock.resetCalls();
    mockDoPullRequestReview.mock.resetCalls();
    mockLoadContext.mock.mockImplementation(async () => ({
      eventName: "pull_request",
      repo: { owner: "test-owner", repo: "test-repo" },
      payload: {
        pull_request: {
          number: 123,
          title: "Test PR",
          body: "Test description",
          head: { sha: "head-sha" },
          base: { sha: "base-sha" },
        },
      },
    }));
    mockDoPullRequestReview.mock.mockImplementation(async () => undefined);
  });

  test("handles pull request event correctly", async () => {
    const context = {
      eventName: "pull_request",
      repo: { owner: "test-owner", repo: "test-repo" },
      payload: {
        pull_request: {
          number: 123,
          title: "Test PR",
          body: "Test description",
          head: { sha: "head-sha" },
          base: { sha: "base-sha" },
        },
      },
    };
    mockLoadContext.mock.mockImplementation(async () => context);

    await handlePullRequest();

    assert.equal(mockLoadContext.mock.callCount(), 1);
    assert.equal(mockDoPullRequestReview.mock.callCount(), 1);
    assert.equal(mockDoPullRequestReview.mock.calls[0].arguments[0], context);
    assert.equal(mockDoPullRequestReview.mock.calls[0].arguments[1], 123);
  });

  test("ignores pull request with skip marker", async () => {
    mockLoadContext.mock.mockImplementation(async () => ({
      eventName: "pull_request",
      repo: { owner: "test-owner", repo: "test-repo" },
      payload: {
        pull_request: {
          number: 123,
          title: "Test PR",
          body: "Test description @presubmit skip",
          head: { sha: "head-sha" },
          base: { sha: "base-sha" },
        },
      },
    }));

    await handlePullRequest();

    assert.equal(mockLoadContext.mock.callCount(), 1);
    assert.equal(mockDoPullRequestReview.mock.callCount(), 0);
  });
});
