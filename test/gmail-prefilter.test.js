import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldSkipGmailMessage, getHeader } from "../lib/gmail/prefilter.js";

describe("gmail prefilter", () => {
  it("skips promotion category", () => {
    const result = shouldSkipGmailMessage({
      labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
      headers: [{ name: "From", value: "bob@example.com" }],
      subject: "Hello",
      threadMessages: [{ from: "lead", text: "Hi" }],
    });
    assert.equal(result.skip, true);
    assert.equal(result.reason, "category_or_spam");
  });

  it("skips no-reply senders", () => {
    const result = shouldSkipGmailMessage({
      labelIds: ["INBOX"],
      headers: [{ name: "From", value: "no-reply@stripe.com" }],
      subject: "Receipt",
      threadMessages: [{ from: "lead", text: "x" }],
    });
    assert.equal(result.skip, true);
    assert.equal(result.reason, "no_reply_sender");
  });

  it("skips OTP subjects", () => {
    const result = shouldSkipGmailMessage({
      labelIds: ["INBOX"],
      headers: [{ name: "From", value: "security@bank.com" }, { name: "Subject", value: "Your OTP code" }],
      subject: "Your OTP code",
      threadMessages: [{ from: "lead", text: "123456" }],
    });
    assert.equal(result.skip, true);
    assert.equal(result.reason, "otp_or_verification");
  });

  it("accepts personal inbound", () => {
    const result = shouldSkipGmailMessage({
      labelIds: ["INBOX"],
      headers: [{ name: "From", value: "Jane Doe <jane@acme.com>" }],
      subject: "Re: intro",
      accountEmail: "me@company.com",
      threadMessages: [{ from: "lead", text: "Can we chat?" }],
    });
    assert.equal(result.skip, false);
  });

  it("getHeader reads case-insensitively", () => {
    assert.equal(getHeader([{ name: "Subject", value: "Hi" }], "subject"), "Hi");
  });
});
