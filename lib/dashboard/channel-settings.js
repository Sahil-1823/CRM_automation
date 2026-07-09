import { jsonResponse, readJsonBody } from "../http.js";
import { requireAuth } from "../auth.js";
import {
  CHANNEL_PROJECT_CHANNELS,
  getChannelProjectSettings,
  setChannelProjectSettings,
  serializeChannelProjectSettingsForDashboard,
} from "../channel-project-settings.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;

    if (req.method === "GET") {
      const settings = await serializeChannelProjectSettingsForDashboard();
      return jsonResponse(res, 200, { settings });
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const patch = {};
      for (const channel of CHANNEL_PROJECT_CHANNELS) {
        if (body[channel] !== undefined) patch[channel] = body[channel];
      }
      if (!Object.keys(patch).length) {
        return jsonResponse(res, 400, { error: "Missing heyreach or gmail projectId" });
      }
      await setChannelProjectSettings(patch);
      const settings = await serializeChannelProjectSettingsForDashboard();
      return jsonResponse(res, 200, { ok: true, settings });
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("channel-settings error:", error);
    return jsonResponse(res, 500, { error: error.message || "Failed to update channel settings" });
  }
}
