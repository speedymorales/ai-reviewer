import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateFileCodeDiff, parseFileDiff } from "../diff";
import type { File } from "../diff";
import { ReviewCommentThread } from "../comments";

describe("Diff Parser", () => {
  const mockFile: File = {
    filename: "src/test.ts",
    status: "modified",
    patch:
      "@@ -1,5 +1,6 @@\n import { something } from 'somewhere';\n \n-function oldFunction() {\n+function newFunction() {\n+  // Added comment\n   return true;\n }\n",
  };

  const mockCommentThreads: ReviewCommentThread[] = [];

  test("parseFileDiff correctly parses hunks", () => {
    const fileDiff = parseFileDiff(mockFile, mockCommentThreads);

    assert.equal(fileDiff.hunks.length, 1);
    assert.equal(fileDiff.hunks[0].startLine, 1);
    assert.equal(fileDiff.hunks[0].endLine, 8);
    assert.match(fileDiff.hunks[0].diff, /@@ -1,5 \+1,6 @@/);
    assert.match(fileDiff.hunks[0].diff, /\+function newFunction\(\) \{/);
    assert.match(fileDiff.hunks[0].diff, /-function oldFunction\(\) \{/);
  });

  test("generateFileCodeDiff formats diff correctly", () => {
    const fileDiff = parseFileDiff(mockFile, mockCommentThreads);
    const formattedDiff = generateFileCodeDiff(fileDiff);

    assert.match(formattedDiff, /## File modified: 'src\/test.ts'/);
    assert.match(formattedDiff, /__new hunk__/);
    assert.match(formattedDiff, /__old hunk__/);
  });

  test("handles files without patches", () => {
    const fileWithoutPatch: File = {
      filename: "src/binary.png",
      status: "added",
    };

    const fileDiff = parseFileDiff(fileWithoutPatch, mockCommentThreads);
    assert.equal(fileDiff.hunks.length, 0);

    const formattedDiff = generateFileCodeDiff(fileDiff);
    assert.match(formattedDiff, /## File added: 'src\/binary.png'/);
  });
});
