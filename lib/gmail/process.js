import { MAX_MESSAGES_PER_WEBHOOK } from "./config.js";
import {
  claimHistoryNotification,
  getGmailAccount,
  updateGmailAccount,
  setGmailThreadIndex,
} from "./store.js";
import { listHistory, getMessage, getThread } from "./oauth.js";
import { shouldSkipGmailMessage } from "./prefilter.js";
import { shapeLeadFromGmail, extractMessageBody } from "./parse.js";
import { extractReplyHeaders } from "./deliver.js";
import { classifyReply } from "../sentiment.js";
import {
  isDraftGenerationEnabled,
  generateDraftForLead,
  emptyDraft,
  shouldAutoSend,
  isGmailAutoSendEnabled,
} from "../draft-pipeline.js";
import { saveEvent, findEventByGmailThread, updateEvent } from "../store.js";
import { deliverGmailReply } from "./deliver.js";

export async function processGmailNotification({ emailAddress, historyId }) {
  const account = await getGmailAccount(emailAddress);
  if (!account) {
    return { ok: true, action: "account_not_found" };
  }

  const claimed = await claimHistoryNotification(emailAddress, historyId);
  if (!claimed) {
    return { ok: true, action: "duplicate_history" };
  }

  const startHistoryId = account.historyId;
  if (!startHistoryId) {
    await updateGmailAccount(emailAddress, { historyId: String(historyId) });
    return { ok: true, action: "history_initialized" };
  }

  let historyData;
  try {
    historyData = await listHistory(emailAddress, startHistoryId);
  } catch (err) {
    if (String(err.message).includes("404")) {
      await updateGmailAccount(emailAddress, { historyId: String(historyId) });
      return { ok: true, action: "history_reset" };
    }
    throw err;
  }

  const records = historyData?.history || [];
  const messageIds = [];
  for (const record of records) {
    for (const added of record.messagesAdded || []) {
      if (added.message?.id) messageIds.push(added.message.id);
    }
  }

  const uniqueIds = [...new Set(messageIds)].slice(0, MAX_MESSAGES_PER_WEBHOOK);
  const results = [];

  for (const msgId of uniqueIds) {
    try {
      const result = await processInboundMessage({
        accountEmail: emailAddress,
        messageId: msgId,
        account,
      });
      results.push(result);
    } catch (err) {
      results.push({ messageId: msgId, error: err.message });
    }
  }

  await updateGmailAccount(emailAddress, { historyId: String(historyId) });

  return {
    ok: true,
    action: "processed",
    processed: results.length,
    results,
  };
}

async function processInboundMessage({ accountEmail, messageId, account }) {
  const message = await getMessage(accountEmail, messageId, "full");
  const thread = await getThread(accountEmail, message.threadId);
  const lead = shapeLeadFromGmail({ message, thread, accountEmail });

  const skip = shouldSkipGmailMessage({
    labelIds: message.labelIds || [],
    headers: lead.headers,
    subject: lead.subject,
    accountEmail,
    threadMessages: lead.conversation,
    handledLabelId: account.handledLabelId || null,
  });

  if (skip.skip) {
    return { messageId, action: "skipped", reason: skip.reason };
  }

  const existing = await findEventByGmailThread(accountEmail, message.threadId, {
    status: "pending_review",
  });
  if (existing && existing.lead?.replyMessage?.trim() === lead.replyMessage?.trim()) {
    return { messageId, action: "duplicate_pending", eventId: existing.id };
  }

  const triage = await classifyReply({
    replyMessage: lead.replyMessage,
    yourMessage: lead.yourMessage,
    leadName: lead.fullName,
    companyName: lead.companyName,
    conversation: lead.conversation,
  });

  let draft = emptyDraft({ skipped: !isDraftGenerationEnabled() });
  let draftProjectId = "all";
  let project = { id: null, name: "All projects", source: "auto" };

  if (isDraftGenerationEnabled()) {
    const result = await generateDraftForLead({ lead, sentiment: triage, channel: "gmail" });
    draft = result.draft;
    draftProjectId = result.draftProjectId;
    project = result.project;
  }

  const replyHeaders = extractReplyHeaders(message);

  const eventPatch = {
    channel: "gmail",
    lead: {
      fullName: lead.fullName,
      companyName: lead.companyName,
      jobTitle: lead.jobTitle,
      subject: lead.subject,
      replyMessage: lead.replyMessage,
      yourMessage: lead.yourMessage,
      conversation: lead.conversation,
      fromEmail: lead.fromEmail,
    },
    gmail: {
      accountEmail,
      threadId: message.threadId,
      messageId: message.id,
      historyId: account.historyId,
      fromEmail: lead.fromEmail,
      fromName: lead.fullName,
      subject: lead.subject,
      snippet: message.snippet || extractMessageBody(message).slice(0, 200),
      labelIds: message.labelIds || [],
      inReplyTo: replyHeaders.inReplyTo,
      references: replyHeaders.references,
    },
    sentiment: {
      label: triage.sentiment,
      isPositive: triage.isPositive,
      reasoning: triage.reasoning,
    },
    handling: {
      requiresHuman: triage.requiresHuman,
      category: triage.category,
      actionItems: triage.actionItems,
      reason: triage.handlingReason,
    },
    draftProjectId,
    project,
    draft,
    status: "pending_review",
  };

  const record = existing
    ? await updateEvent(existing.id, {
        ...eventPatch,
        refreshedAt: new Date().toISOString(),
      })
    : await saveEvent(eventPatch);

  await setGmailThreadIndex(accountEmail, message.threadId, record.id);

  if (
    isGmailAutoSendEnabled() &&
    account.autoSend &&
    shouldAutoSend(record).allowed
  ) {
    await deliverGmailReply(record, draft.reply);
    return { messageId, action: "auto_sent", eventId: record.id };
  }

  return { messageId, action: "pending_review", eventId: record.id };
}
