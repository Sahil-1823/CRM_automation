export function buildConversationContext(lead) {
  const parts = [];
  if (lead.fullName) parts.push(`Lead: ${lead.fullName}`);
  if (lead.companyName) parts.push(`Company: ${lead.companyName}`);
  if (lead.jobTitle) parts.push(`Title: ${lead.jobTitle}`);

  if (lead.conversation?.length) {
    parts.push(
      "Thread:\n" +
        lead.conversation
          .map((m) => `${m.from === "lead" ? "Lead" : "Us"}: ${m.text}`)
          .join("\n"),
    );
  } else {
    if (lead.yourMessage) parts.push(`Our message: ${lead.yourMessage}`);
    if (lead.replyMessage) parts.push(`Lead reply: ${lead.replyMessage}`);
  }

  return parts.join("\n");
}
