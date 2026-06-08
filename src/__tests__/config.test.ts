import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

const mockGetInput = mock.fn<(name: string) => string>(() => "");
const mockGetMultilineInput = mock.fn<(name: string) => string[]>(() => []);
const mockInfo = mock.fn<(...args: unknown[]) => void>();
const mockWarning = mock.fn<(...args: unknown[]) => void>();

let Config: typeof import("../config").Config;

describe("Config", () => {
  const originalEnv = process.env;

  before(async () => {
    const actionsCoreMock = {
      exports: {
        getInput: mockGetInput,
        getMultilineInput: mockGetMultilineInput,
        info: mockInfo,
        warning: mockWarning,
      },
    } as unknown as Parameters<typeof mock.module>[1];

    mock.module("@actions/core", actionsCoreMock);

    ({ Config } = await import("../config"));
  });

  beforeEach(() => {
    mockGetInput.mock.resetCalls();
    mockGetInput.mock.mockImplementation(() => "");
    mockGetMultilineInput.mock.resetCalls();
    mockGetMultilineInput.mock.mockImplementation(() => []);
    mockInfo.mock.resetCalls();
    mockWarning.mock.resetCalls();
    process.env = { ...originalEnv };
  });

  after(() => {
    process.env = originalEnv;
  });

  test("throws error when GITHUB_TOKEN is not set", () => {
    process.env.GITHUB_TOKEN = "";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";

    assert.throws(() => new Config(), /GITHUB_TOKEN is not set/);
  });

  test("throws error when LLM_API_KEY is not set", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "";
    process.env.LLM_MODEL = "test-model";

    assert.throws(() => new Config(), /LLM_API_KEY is not set/);
  });

  test("throws error when LLM_MODEL is not set", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "";

    assert.throws(() => new Config(), /LLM_MODEL is not set/);
  });

  test("loads style guide rules from action inputs", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";
    process.env.DEBUG = "";

    const styleGuideRules = ["Rule 1", "Rule 2", "Rule 3"];
    mockGetMultilineInput.mock.mockImplementation((name: string) => {
      if (name === "style_guide_rules") {
        return styleGuideRules;
      }
      return [];
    });

    const config = new Config();
    config.loadInputs();

    assert.equal(config.styleGuideRules, styleGuideRules.join("\n"));
  });

  test("uses default GitHub URLs when not provided", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";

    const config = new Config();

    assert.equal(config.githubApiUrl, "https://api.github.com");
    assert.equal(config.githubServerUrl, "https://github.com");
  });

  test("loads GitHub Enterprise Server URLs from environment variables", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";
    process.env.GITHUB_API_URL = "https://github.example.com/api/v3";
    process.env.GITHUB_SERVER_URL = "https://github.example.com";

    const config = new Config();

    assert.equal(config.githubApiUrl, "https://github.example.com/api/v3");
    assert.equal(config.githubServerUrl, "https://github.example.com");
  });

  test("loads GitHub Enterprise Server URLs from action inputs", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";

    mockGetInput.mock.mockImplementation((name: string) => {
      if (name === "github_api_url") {
        return "https://github.example.com/api/v3";
      }
      if (name === "github_server_url") {
        return "https://github.example.com";
      }
      return "";
    });

    const config = new Config();

    assert.equal(config.githubApiUrl, "https://github.example.com/api/v3");
    assert.equal(config.githubServerUrl, "https://github.example.com");
  });

  test("loads LLM_BASE_URL from environment variable", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";

    const config = new Config();

    assert.equal(config.llmBaseUrl, "https://openrouter.ai/api/v1");
  });

  test("llmBaseUrl is undefined when not set", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";

    const config = new Config();

    assert.equal(config.llmBaseUrl, undefined);
  });

  test("loads LLM_BASE_URL from action input", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "test-model";

    mockGetInput.mock.mockImplementation((name: string) => {
      if (name === "llm_base_url") {
        return "https://anyscale.com/api/v1";
      }
      return "";
    });

    const config = new Config();

    assert.equal(config.llmBaseUrl, "https://anyscale.com/api/v1");
  });
});
