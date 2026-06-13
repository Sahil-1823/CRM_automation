const LINKEDIN_KEYS = [
  "linkedInUrl",
  "linkedinUrl",
  "linkedin_url",
  "profileUrl",
  "profile_url",
  "linkedInProfileUrl",
  "linkedinProfileUrl",
];

const MESSAGE_KEYS = [
  "message",
  "replyMessage",
  "reply_message",
  "latestMessage",
  "latest_message",
  "leadMessage",
  "lead_message",
  "text",
  "body",
];

const YOUR_MESSAGE_KEYS = [
  "yourMessage",
  "your_message",
  "sentMessage",
  "sent_message",
  "previousMessage",
  "previous_message",
  "outboundMessage",
  "outbound_message",
];

function pickString(source, keys) {
  if (!source || typeof source !== "object") {
    return "";
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function pickNestedString(payload, paths) {
  for (const path of paths) {
    let current = payload;
    for (const segment of path) {
      if (!current || typeof current !== "object") {
        current = null;
        break;
      }
      current = current[segment];
    }

    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
  }

  return "";
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function normalizeLinkedInUrl(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

export function verifyHeyReachSecret(req, secret) {
  if (!secret) {
    return true;
  }

  const authHeader = req.headers.authorization ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const headerSecret =
    req.headers["x-webhook-secret"] ??
    req.headers["x-heyreach-secret"] ??
    req.headers["x-heyreach-webhook-secret"] ??
    "";

  return bearer === secret || headerSecret === secret;
}

export function parseHeyReachPayload(payload) {
  const lead = payload.lead ?? payload.contact ?? payload.prospect ?? payload;
  const firstName =
    pickString(lead, ["firstName", "first_name", "givenName", "given_name"]) ||
    pickNestedString(payload, [["lead", "firstName"], ["contact", "firstName"]]);
  const lastName =
    pickString(lead, ["lastName", "last_name", "familyName", "family_name"]) ||
    pickNestedString(payload, [["lead", "lastName"], ["contact", "lastName"]]);
  const fullName =
    pickString(lead, ["fullName", "full_name", "name"]) ||
    pickString(payload, ["leadName", "lead_name", "name"]) ||
    [firstName, lastName].filter(Boolean).join(" ");

  const nameParts = firstName || lastName ? { firstName, lastName } : splitName(fullName);
  const linkedInUrl = normalizeLinkedInUrl(
    pickString(lead, LINKEDIN_KEYS) ||
      pickString(payload, LINKEDIN_KEYS) ||
      pickNestedString(payload, [
        ["lead", "profileUrl"],
        ["lead", "linkedInUrl"],
        ["contact", "profileUrl"],
      ]),
  );

  const replyMessage =
    pickString(payload, MESSAGE_KEYS) ||
    pickString(lead, MESSAGE_KEYS) ||
    pickNestedString(payload, [
      ["message", "text"],
      ["reply", "message"],
      ["reply", "text"],
    ]);

  const yourMessage =
    pickString(payload, YOUR_MESSAGE_KEYS) ||
    pickNestedString(payload, [
      ["yourMessage", "text"],
      ["outbound", "message"],
      ["campaignMessage", "text"],
    ]);

  const companyName =
    pickString(lead, ["companyName", "company_name", "company"]) ||
    pickString(payload, ["companyName", "company_name", "company"]) ||
    pickNestedString(payload, [["lead", "companyName"], ["company", "name"]]);

  const jobTitle =
    pickString(lead, ["jobTitle", "job_title", "position", "title"]) ||
    pickString(payload, ["jobTitle", "job_title", "position", "title"]);

  const email =
    pickString(lead, ["email", "emailAddress", "email_address"]) ||
    pickString(payload, ["email", "emailAddress", "email_address"]);

  const campaignName =
    pickString(payload, ["campaignName", "campaign_name"]) ||
    pickString(payload.campaign ?? {}, ["name", "campaignName"]) ||
    "";

  const conversationId =
    pickString(payload, ["conversationId", "conversation_id"]) ||
    pickString(payload.conversation ?? {}, ["id", "conversationId"]) ||
    "";

  const eventType =
    pickString(payload, ["eventType", "event_type", "type", "event"]) || "";

  const leadName = [nameParts.firstName, nameParts.lastName].filter(Boolean).join(" ") || fullName;

  const errors = [];
  if (!leadName) {
    errors.push("lead name");
  }
  if (!replyMessage) {
    errors.push("reply message");
  }
  if (!linkedInUrl) {
    errors.push("LinkedIn URL");
  }

  return {
    valid: errors.length === 0,
    errors,
    lead: {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      fullName: leadName,
      linkedInUrl,
      companyName,
      jobTitle,
      email,
      replyMessage,
      yourMessage,
      campaignName,
      conversationId,
      eventType,
    },
  };
}
