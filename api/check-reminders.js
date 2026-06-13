import { verifyCronRequest } from "../lib/cron-auth.js";
import { jsonResponse } from "../lib/http.js";
import { runReminderCheck, markReminderSent } from "../lib/crm/index.js";
import { formatReminderMessage, notifySlack, notifySlackError } from "../lib/slack.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  if (!verifyCronRequest(req)) {
    return jsonResponse(res, 401, { error: "Unauthorized" });
  }

  try {
    const matches = await runReminderCheck();
    const sent = [];

    for (const match of matches) {
      const text = formatReminderMessage(match);

      try {
        await notifySlack(text);
        await markReminderSent(match.dealRecordId, match.days);
        sent.push({
          dealRecordId: match.dealRecordId,
          dealName: match.dealName,
          reminderDay: match.days,
        });
      } catch (error) {
        console.error(`Failed reminder for deal ${match.dealRecordId}:`, error);
        await notifySlackError(error.message, {
          endpoint: "/api/check-reminders",
          deal: match,
        });
      }
    }

    return jsonResponse(res, 200, {
      ok: true,
      checkedAt: new Date().toISOString(),
      matched: matches.length,
      sent,
    });
  } catch (error) {
    console.error("check-reminders error:", error);

    try {
      await notifySlackError(error.message, {
        endpoint: "/api/check-reminders",
        stack: error.stack,
      });
    } catch (notifyError) {
      console.error("Failed to notify Slack about reminder error:", notifyError);
    }

    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
