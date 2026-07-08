import test from "node:test";
import assert from "node:assert/strict";
import {
  slugifyHeyReachAccountId,
  generateWebhookSecret,
  buildHeyReachWebhookUrl,
  serializeHeyReachAccountForDashboard,
  DEFAULT_ACCOUNT_ID,
} from "../lib/heyreach/accounts-store.js";

test("slugifyHeyReachAccountId normalizes labels", () => {
  assert.equal(slugifyHeyReachAccountId("Acme Sales Team"), "acme-sales-team");
  assert.equal(slugifyHeyReachAccountId("  "), "workspace");
});

test("generateWebhookSecret returns hex string", () => {
  const secret = generateWebhookSecret();
  assert.match(secret, /^[a-f0-9]{48}$/);
});

test("buildHeyReachWebhookUrl includes account and token query params", () => {
  const url = buildHeyReachWebhookUrl(
    { id: "acme", webhookSecret: "abc123" },
    "https://crm.example.com",
  );
  assert.equal(
    url,
    "https://crm.example.com/api/heyreach-webhook?account=acme&token=abc123",
  );
});

test("serializeHeyReachAccountForDashboard hides raw api key", () => {
  const out = serializeHeyReachAccountForDashboard(
    {
      id: "acme",
      label: "Acme",
      apiKey: "1234567890abcdef",
      webhookSecret: "secret",
      projectId: "p1",
    },
    { baseUrl: "https://crm.example.com" },
  );
  assert.equal(out.hasApiKey, true);
  assert.equal(out.apiKeyPreview, "1234…cdef");
  assert.ok(out.webhookUrl.includes(`account=acme`));
});

test("DEFAULT_ACCOUNT_ID is reserved slug", () => {
  assert.equal(DEFAULT_ACCOUNT_ID, "default");
});
