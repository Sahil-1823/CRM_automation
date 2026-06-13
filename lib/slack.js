import { getConfig } from "./config.js";

async function postWebhook(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${body}`);
  }
}

export async function notifySlack(text, blocks) {
  const { slack } = getConfig();
  await postWebhook(slack.webhookUrl, blocks ? { text, blocks } : { text });
}

export async function notifySlackError(message, context = {}) {
  const { slack } = getConfig();
  const text = `:warning: *CRM automation error*\n${message}`;

  if (!slack.errorWebhookUrl) {
    console.error(text, context);
    return;
  }

  await postWebhook(slack.errorWebhookUrl, {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`\`\`${JSON.stringify(context, null, 2).slice(0, 2800)}\`\`\``,
        },
      },
    ],
  });
}

export function formatReminderMessage({ dealName, days, linkedInUrl, companyName, createdAt }) {
  const created = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : "unknown";
  const linkedInLine = linkedInUrl ? `<${linkedInUrl}|LinkedIn profile>` : "_No LinkedIn URL_";

  return (
    `:bell: *Day-${days} reminder* — *${dealName}* has been in *Lead Interested* for ~${days} days.\n` +
    `${linkedInLine}${companyName ? `\nCompany: ${companyName}` : ""}\n` +
    `Created: ${created}`
  );
}
