import assert from "node:assert/strict";
import { before, beforeEach, describe, mock, test } from "node:test";
import type { Context } from "@actions/github/lib/context";
import type { FileDiff } from "../diff";
import type { AIComment, PullRequestSummary } from "../prompts";

const mockConfig = {
  githubToken: "mock-token",
  llmApiKey: "mock-api-key",
  llmModel: "mock-model",
  styleGuideRules: "",
  githubApiUrl: "https://api.github.com",
  githubServerUrl: "https://github.com",
  loadInputs: () => undefined,
};

let OVERVIEW_MESSAGE_SIGNATURE: string;
let PAYLOAD_TAG_CLOSE: string;
let PAYLOAD_TAG_OPEN: string;
let buildLoadingMessage: typeof import("../messages").buildLoadingMessage;
let buildOverviewMessage: typeof import("../messages").buildOverviewMessage;
let buildReviewSummary: typeof import("../messages").buildReviewSummary;

function createMockFileDiffs(): FileDiff[] {
  return [
    {
      filename: "src/test1.ts",
      status: "modified",
      hunks: [
        { startLine: 1, endLine: 5, diff: "@@ -1,3 +1,5 @@\n test\n+added\n+more" },
      ],
    },
    {
      filename: "src/test2.ts",
      status: "added",
      hunks: [
        { startLine: 1, endLine: 3, diff: "@@ -0,0 +1,3 @@\n+new file\n+content\n+here" },
      ],
    },
  ];
}

function createMockCommits() {
  return [
    { sha: "abc123", commit: { message: "First commit" } },
    { sha: "def456", commit: { message: "Second commit" } },
  ];
}

describe("Messages", () => {
  const mockContext = {
    repo: { owner: "test-owner", repo: "test-repo" },
  } as Context;

  before(async () => {
    await mock.module("@actions/github", {
      exports: {
        context: {
          repo: {
            owner: "test-owner",
            repo: "test-repo",
          },
        },
      },
    });

    await mock.module("../config.ts", {
      exports: {
        default: mockConfig,
      },
    });

    ({
      OVERVIEW_MESSAGE_SIGNATURE,
      PAYLOAD_TAG_CLOSE,
      PAYLOAD_TAG_OPEN,
      buildLoadingMessage,
      buildOverviewMessage,
      buildReviewSummary,
    } = await import("../messages.ts"));
  });

  beforeEach(() => {
    mockConfig.githubServerUrl = "https://github.com";
  });

  test("buildLoadingMessage formats correctly", () => {
    const message = buildLoadingMessage(
      "base-sha",
      createMockCommits(),
      createMockFileDiffs()
    );

    assert.match(message, /Analyzing changes in this PR/);
    assert.match(message, /base-sh/);
    assert.match(message, /abc123/);
    assert.match(message, /def456/);
    assert.match(message, /First commit/);
    assert.match(message, /Second commit/);
    assert.match(message, /src\/test1.ts/);
    assert.match(message, /src\/test2.ts/);
    assert.match(message, new RegExp(OVERVIEW_MESSAGE_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(message, /https:\/\/github.com\/test-owner\/test-repo\/commit\//);
  });

  test("buildOverviewMessage formats correctly", () => {
    const mockSummary: PullRequestSummary = {
      title: "Test PR",
      description: "This is a test PR",
      files: [
        { filename: "src/test1.ts", summary: "Modified test file", title: "Test 1" },
        { filename: "src/test2.ts", summary: "Added new file", title: "Test 2" },
      ],
      type: ["ENHANCEMENT"],
    };

    const message = buildOverviewMessage(mockSummary, ["commit1", "commit2"]);

    assert.match(message, /PR Summary/);
    assert.match(message, /This is a test PR/);
    assert.match(message, /src\/test1.ts/);
    assert.match(message, /Modified test file/);
    assert.match(message, /src\/test2.ts/);
    assert.match(message, /Added new file/);
    assert.match(message, new RegExp(OVERVIEW_MESSAGE_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(message, new RegExp(PAYLOAD_TAG_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(message, new RegExp(PAYLOAD_TAG_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(message, /"commits":\["commit1","commit2"\]/);
  });

  test("buildReviewSummary formats correctly with comments", () => {
    const mockActionableComments: AIComment[] = [
      {
        file: "src/test1.ts",
        start_line: 2,
        end_line: 3,
        highlighted_code: "+added",
        header: "Potential issue",
        content: "This might cause a problem",
        label: "possible bug",
        critical: true,
      },
    ];

    const mockSkippedComments: AIComment[] = [
      {
        file: "src/test2.ts",
        start_line: 1,
        end_line: 1,
        highlighted_code: "+new file",
        header: "Style suggestion",
        content: "Consider using a different style",
        label: "style",
        critical: false,
      },
    ];

    const summary = buildReviewSummary(
      mockContext,
      createMockFileDiffs(),
      createMockCommits(),
      mockActionableComments,
      mockSkippedComments
    );

    assert.match(summary, /Pull request needs attention/);
    assert.match(summary, /Review Summary/);
    assert.match(summary, /Commits Considered \(2\)/);
    assert.match(summary, /Files Processed \(2\)/);
    assert.match(summary, /Actionable Comments \(1\)/);
    assert.match(summary, /Skipped Comments \(1\)/);
    assert.match(summary, /src\/test1.ts \[2-3\]/);
    assert.match(summary, /possible bug: "Potential issue"/);
    assert.match(summary, /src\/test2.ts \[1-1\]/);
    assert.match(summary, /style: "Style suggestion"/);
    assert.match(summary, /https:\/\/github.com\/test-owner\/test-repo\/commit\//);
  });

  test("buildReviewSummary formats correctly with no comments", () => {
    const summary = buildReviewSummary(
      mockContext,
      createMockFileDiffs(),
      createMockCommits(),
      [],
      []
    );

    assert.match(summary, /LGTM!/);
    assert.match(summary, /Actionable Comments \(0\)/);
    assert.match(summary, /Skipped Comments \(0\)/);
    assert.match(summary, /https:\/\/github.com\/test-owner\/test-repo\/commit\//);
  });

  test("buildLoadingMessage uses custom GitHub server URL", () => {
    mockConfig.githubServerUrl = "https://github.example.com";

    const message = buildLoadingMessage(
      "base-sha",
      createMockCommits(),
      createMockFileDiffs()
    );

    assert.match(message, /https:\/\/github.example.com\/test-owner\/test-repo\/commit\//);
  });
});
