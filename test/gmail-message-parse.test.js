import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shapeLeadFromGmail, extractMessageBody } from "../lib/gmail/parse.js";

describe("gmail message parse", () => {
  it("extracts plain text body", () => {
    const body = extractMessageBody({
      payload: {
        mimeType: "text/plain",
        body: { data: Buffer.from("Hello there").toString("base64") },
      },
    });
    assert.equal(body, "Hello there");
  });

  it("shapes lead and conversation from thread", () => {
    const account = "me@company.com";
    const message = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX"],
      snippet: "Can we meet?",
      payload: {
        headers: [
          { name: "From", value: "Jane Doe <jane@acme.com>" },
          { name: "Subject", value: "Quick chat" },
        ],
        mimeType: "text/plain",
        body: { data: Buffer.from("Can we meet next week?").toString("base64") },
      },
    };
    const thread = {
      messages: [
        {
          id: "msg0",
          payload: {
            headers: [{ name: "From", value: "me@company.com" }],
            mimeType: "text/plain",
            body: { data: Buffer.from("Following up").toString("base64") },
          },
        },
        message,
      ],
    };

    const lead = shapeLeadFromGmail({ message, thread, accountEmail: account });
    assert.equal(lead.fullName, "Jane Doe");
    assert.equal(lead.fromEmail, "jane@acme.com");
    assert.equal(lead.subject, "Quick chat");
    assert.match(lead.replyMessage, /meet/);
    assert.ok(lead.conversation.length >= 2);
    assert.equal(lead.conversation.at(-1).from, "lead");
  });
});
