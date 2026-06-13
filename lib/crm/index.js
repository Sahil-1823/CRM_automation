import { createCrmClient } from "./attio.js";

export { createCrmClient };

export async function pushPositiveLeadToCrm(lead) {
  const crm = createCrmClient();
  return crm.pushPositiveLead(lead);
}

export async function runReminderCheck() {
  const crm = createCrmClient();
  const deals = await crm.listInterestedLinkedInDeals();
  const now = Date.now();
  const matches = [];

  for (const deal of deals) {
    const values = deal.values ?? {};
    const createdAt = crm.getCreatedAt(deal);
    if (!createdAt) {
      continue;
    }

    const daysSinceCreated = Math.floor((now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
    const reminderDay = getReminderDay(daysSinceCreated);
    if (!reminderDay) {
      continue;
    }

    const lastReminder = crm.getTextValue(values, crm.config.dealLastReminderAttr);
    if (lastReminder === String(reminderDay)) {
      continue;
    }

    const dealName = crm.getTextValue(values, "name") || "Unknown deal";
    const personRecordId = crm.getAssociatedPersonRecordId(values);

    let linkedInUrl = "";
    let companyName = "";

    if (personRecordId) {
      try {
        const person = await crm.getPersonRecord(personRecordId);
        linkedInUrl = crm.getLinkedInFromPerson(person.values ?? {});
      } catch (error) {
        console.warn(`Could not load person ${personRecordId}:`, error.message);
      }
    }

    const companyRecordId = values.associated_company?.[0]?.target_record_id;
    if (companyRecordId) {
      try {
        const company = await crm.getCompanyRecord(companyRecordId);
        companyName = crm.getTextValue(company.values ?? {}, "name");
      } catch (error) {
        console.warn(`Could not load company ${companyRecordId}:`, error.message);
      }
    }

    matches.push({
      dealRecordId: crm.getRecordId(deal),
      dealName,
      days: reminderDay,
      daysSinceCreated,
      linkedInUrl,
      companyName,
      createdAt,
    });
  }

  return matches;
}

export function getReminderDay(daysSinceCreated) {
  if (daysSinceCreated >= 2 && daysSinceCreated <= 4) {
    return 3;
  }
  if (daysSinceCreated >= 6 && daysSinceCreated <= 8) {
    return 7;
  }
  if (daysSinceCreated >= 13 && daysSinceCreated <= 15) {
    return 14;
  }
  return null;
}

export async function markReminderSent(dealRecordId, reminderDay) {
  const crm = createCrmClient();
  await crm.updateDealLastReminderDay(dealRecordId, reminderDay);
}
