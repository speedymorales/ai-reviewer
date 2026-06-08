import assert from "node:assert/strict";
import { before, beforeEach, describe, mock, test } from "node:test";

const mockWarning = mock.fn();
const constructOctokit = mock.fn((options: Record<string, unknown>) => ({
  options,
  rest: {
    repos: {},
    pulls: {},
    issues: {},
  },
}));
const mockPlugin = mock.fn(() => MockOctokit as any);
const retry = {};
const throttling = {};

function MockOctokit(this: unknown, options: Record<string, unknown>) {
  return constructOctokit(options);
}

Object.defineProperty(MockOctokit, "plugin", {
  value: mockPlugin,
});

let initOctokit: typeof import("../octokit").initOctokit;

describe("Octokit", () => {
  before(async () => {
    await mock.module("@actions/core", {
      exports: {
        warning: (...args: any[]) => mockWarning(...args),
      },
    });

    await mock.module("@octokit/action", {
      exports: {
        Octokit: MockOctokit as any,
      },
    });

    await mock.module("@octokit/plugin-retry", {
      exports: {
        retry,
      },
    });

    await mock.module("@octokit/plugin-throttling", {
      exports: {
        throttling,
      },
    });

    ({ initOctokit } = await import("../octokit.ts"));
  });
  beforeEach(() => {
    constructOctokit.mock.resetCalls();
    mockWarning.mock.resetCalls();
  });

  test("initializes with a token", () => {
    const octokit = initOctokit("test-token");

    assert.ok(octokit);
    assert.equal(constructOctokit.mock.callCount(), 1);
    assert.equal(constructOctokit.mock.calls[0].arguments[0].auth, "test-token");
    assert.equal(constructOctokit.mock.calls[0].arguments[0].baseUrl, undefined);
  });

  test("throws when no token is provided", () => {
    assert.throws(
      () => initOctokit(),
      /GitHub token is required but was not provided/
    );
  });

  test("initializes with a token and baseUrl", () => {
    const octokit = initOctokit(
      "test-token",
      "https://github.example.com/api/v3"
    );

    assert.ok(octokit);
    assert.equal(constructOctokit.mock.callCount(), 1);
    assert.equal(
      constructOctokit.mock.calls[0].arguments[0].baseUrl,
      "https://github.example.com/api/v3"
    );
  });
});
