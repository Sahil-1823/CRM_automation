function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export function getConfig() {
  return {
    openai: {
      apiKey: required("OPENAI_API_KEY"),
      model: optional("OPENAI_MODEL", "gpt-4o-mini"),
    },
    crm: {
      provider: optional("CRM_PROVIDER", "attio"),
      apiKey: required("CRM_API_KEY"),
      baseUrl: optional("CRM_BASE_URL", "https://api.attio.com/v2").replace(/\/$/, ""),
      personLinkedInAttr: optional("CRM_PERSON_LINKEDIN_ATTR", "linkedin"),
      dealStageAttr: optional("CRM_DEAL_STAGE_ATTR", "stage"),
      dealSourceAttr: optional("CRM_DEAL_SOURCE_ATTR", "source"),
      dealOwnerAttr: optional("CRM_DEAL_OWNER_ATTR", "owner"),
      dealLastReminderAttr: optional("CRM_DEAL_LAST_REMINDER_ATTR", "last_reminder_day"),
      dealStageInterested: optional("CRM_DEAL_STAGE_INTERESTED", "Lead Interested"),
      dealSourceLinkedIn: optional("CRM_DEAL_SOURCE_LINKEDIN", "Cold LinkedIn"),
      attributionListSlug: optional("CRM_ATTRIBUTION_LIST_SLUG", "linkedin-attribution"),
      dealOwnerRecordId: optional("CRM_DEAL_OWNER_RECORD_ID"),
    },
    slack: {
      webhookUrl: required("SLACK_WEBHOOK_URL"),
      errorWebhookUrl: optional("SLACK_ERROR_WEBHOOK_URL"),
    },
    heyreach: {
      webhookSecret: optional("HEYREACH_WEBHOOK_SECRET"),
    },
    cron: {
      secret: optional("CRON_SECRET"),
    },
  };
}
