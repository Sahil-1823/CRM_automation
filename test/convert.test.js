import test from "node:test";
import assert from "node:assert/strict";
import { convertFileToMarkdown } from "../lib/convert-to-md.js";

test("convertFileToMarkdown converts plain text to markdown", async () => {
  const buffer = Buffer.from("Hello world.\n\nSecond paragraph.", "utf8");
  const result = await convertFileToMarkdown(buffer, "notes.txt");
  assert.equal(result.sourceExt, ".txt");
  assert.match(result.markdown, /^# notes/);
  assert.match(result.markdown, /Hello world/);
});

test("convertFileToMarkdown keeps markdown files with heading", async () => {
  const buffer = Buffer.from("# Already titled\n\nBody text.", "utf8");
  const result = await convertFileToMarkdown(buffer, "guide.md");
  assert.match(result.markdown, /^# Already titled/);
});

test("convertFileToMarkdown rejects empty files", async () => {
  await assert.rejects(
    () => convertFileToMarkdown(Buffer.from(""), "empty.txt"),
    /empty/i,
  );
});
