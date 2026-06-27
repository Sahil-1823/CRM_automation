import { readJsonBody, jsonResponse } from "../../http.js";
import { getGmailConfig } from "../../gmail/config.js";
import { processGmailNotification } from "../../gmail/process.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const { webhookSecret } = getGmailConfig();

    if (!webhookSecret || token !== webhookSecret) {
      return jsonResponse(res, 401, { error: "Unauthorized" });
    }

    const body = await readJsonBody(req);
    const message = body?.message;
    if (!message?.data) {
      return jsonResponse(res, 200, { ok: true, action: "empty" });
    }

    const decoded = JSON.parse(
      Buffer.from(message.data, "base64").toString("utf8"),
    );

    const emailAddress = decoded.emailAddress;
    const historyId = decoded.historyId;

    if (!emailAddress || !historyId) {
      return jsonResponse(res, 200, { ok: true, action: "invalid_payload" });
    }

    const result = await processGmailNotification({ emailAddress, historyId });
    return jsonResponse(res, 200, result);
  } catch (error) {
    console.error("gmail webhook error:", error);
    return jsonResponse(res, 200, { ok: false, error: "processing_failed" });
  }
}
