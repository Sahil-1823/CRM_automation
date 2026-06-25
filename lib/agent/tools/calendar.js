import { registerTool } from "../tools.js";
import { checkSlotAvailability, findAvailableSlots } from "../../calendar/google.js";
import { isGoogleCalendarConnected } from "../../calendar/store.js";
import { getGoogleCalendarConfig } from "../../calendar/config.js";

registerTool("checkAvailability", {
  description: "Check if a specific time range is free on Google Calendar",
  parameters: {
    type: "object",
    properties: {
      start: { type: "string", description: "ISO start datetime" },
      end: { type: "string", description: "ISO end datetime" },
    },
    required: ["start", "end"],
  },
  handler: async ({ start, end }) => {
    if (!(await isGoogleCalendarConnected())) {
      return { connected: false, available: null, error: "Google Calendar not connected" };
    }
    const result = await checkSlotAvailability({ start, end });
    return { connected: true, ...result };
  },
});

registerTool("findOpenSlots", {
  description: "Find open meeting slots in the next week during working hours",
  parameters: {
    type: "object",
    properties: {
      durationMin: { type: "number" },
      maxSlots: { type: "number" },
    },
  },
  handler: async ({ durationMin, maxSlots = 3 } = {}) => {
    if (!(await isGoogleCalendarConnected())) {
      return { connected: false, slots: [], error: "Google Calendar not connected" };
    }
    const config = getGoogleCalendarConfig();
    const slots = await findAvailableSlots({
      durationMin: durationMin || config.defaultDurationMin,
      maxSlots: maxSlots || 3,
    });
    return { connected: true, slots };
  },
});
