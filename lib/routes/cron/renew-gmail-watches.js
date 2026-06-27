import { jsonResponse } from "../../http.js";
import { listGmailAccounts, getGmailAccount, updateGmailAccount } from "../../gmail/store.js";
import { watchInbox } from "../../gmail/oauth.js";
import { getGmailConfig } from "../../gmail/config.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    const { pubsubTopic } = getGmailConfig();
    if (!pubsubTopic) {
      return jsonResponse(res, 200, { ok: true, renewed: 0, skipped: "no_pubsub_topic" });
    }

    const emails = await listGmailAccounts();
    let renewed = 0;
    const errors = [];

    for (const email of emails) {
      try {
        const watch = await watchInbox(email, pubsubTopic);
        await updateGmailAccount(email, {
          historyId: watch?.historyId ? String(watch.historyId) : (await getGmailAccount(email))?.historyId,
          watchExpiration: watch?.expiration ? Number(watch.expiration) : null,
        });
        renewed += 1;
      } catch (err) {
        errors.push({ email, error: err.message });
      }
    }

    return jsonResponse(res, 200, { ok: true, renewed, errors });
  } catch (error) {
    console.error("renew-gmail-watches error:", error);
    return jsonResponse(res, 500, { error: "Failed to renew Gmail watches" });
  }
}
