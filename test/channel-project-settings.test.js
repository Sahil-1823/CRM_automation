import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectIdBinding, normalizeProjectId } from "../lib/channel-project-settings.js";

test("resolveProjectIdBinding maps none and all", async () => {
  const none = await resolveProjectIdBinding("none");
  assert.equal(none.projectScopeOverride, "none");
  assert.equal(none.draftProjectId, "none");

  const all = await resolveProjectIdBinding("all");
  assert.equal(all.projectScopeOverride, "all");
  assert.equal(all.draftProjectId, "all");
});

test("normalizeProjectId trims and normalizes", () => {
  assert.equal(normalizeProjectId("  all  "), "all");
  assert.equal(normalizeProjectId("none"), "none");
  assert.equal(normalizeProjectId("proj_abc"), "proj_abc");
});
