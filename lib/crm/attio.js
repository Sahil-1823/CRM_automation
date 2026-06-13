import { getConfig } from "../config.js";

export class AttioClient {
  constructor(config = getConfig().crm) {
    this.config = config;
  }

  async request(method, path, { body, query } = {}) {
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data?.message
          ? data.message
          : `Attio API error (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.response = data;
      throw error;
    }

    return data;
  }

  getRecordId(record) {
    return record?.id?.record_id ?? record?.data?.id?.record_id ?? null;
  }

  getCreatedAt(record) {
    return record?.created_at ?? record?.data?.created_at ?? null;
  }

  getTextValue(values, attribute) {
    const entries = values?.[attribute];
    if (!Array.isArray(entries) || entries.length === 0) {
      return "";
    }

    const first = entries[0];
    return first?.value ?? first?.status ?? first?.option ?? "";
  }

  getStatusTitle(values, attribute) {
    const entries = values?.[attribute];
    if (!Array.isArray(entries) || entries.length === 0) {
      return "";
    }

    return entries[0]?.status?.title ?? entries[0]?.status ?? "";
  }

  getSelectValue(values, attribute) {
    const entries = values?.[attribute];
    if (!Array.isArray(entries) || entries.length === 0) {
      return "";
    }

    return entries[0]?.option?.title ?? entries[0]?.option ?? entries[0]?.value ?? "";
  }

  getLinkedInFromPerson(values) {
    return this.getTextValue(values, this.config.personLinkedInAttr);
  }

  getAssociatedPersonRecordId(values) {
    const entries = values?.associated_people;
    if (!Array.isArray(entries) || entries.length === 0) {
      return "";
    }

    return entries[0]?.target_record_id ?? "";
  }

  async findPersonByLinkedIn(linkedInUrl) {
    const filter = {
      [this.config.personLinkedInAttr]: linkedInUrl,
    };

    const result = await this.request("POST", "/objects/people/records/query", {
      body: { filter, limit: 1 },
    });

    return result.data?.[0] ?? null;
  }

  async upsertPerson(lead) {
    const values = {
      name: [
        {
          first_name: lead.firstName || lead.fullName,
          last_name: lead.lastName || "",
          full_name: lead.fullName,
        },
      ],
      [this.config.personLinkedInAttr]: [{ value: lead.linkedInUrl }],
    };

    if (lead.email) {
      values.email_addresses = [{ email_address: lead.email }];
    }

    if (lead.jobTitle) {
      values.job_title = [{ value: lead.jobTitle }];
    }

    const result = await this.request("PUT", "/objects/people/records", {
      query: { matching_attribute: this.config.personLinkedInAttr },
      body: { data: { values } },
    });

    return result.data;
  }

  async upsertCompany(companyName) {
    if (!companyName) {
      return null;
    }

    const result = await this.request("PUT", "/objects/companies/records", {
      query: { matching_attribute: "name" },
      body: {
        data: {
          values: {
            name: [{ value: companyName }],
          },
        },
      },
    });

    return result.data;
  }

  async findExistingInterestedDeal(personRecordId) {
    const filter = {
      $and: [
        { [this.config.dealStageAttr]: this.config.dealStageInterested },
        { [this.config.dealSourceAttr]: this.config.dealSourceLinkedIn },
        {
          associated_people: {
            target_object: "people",
            target_record_id: personRecordId,
          },
        },
      ],
    };

    const result = await this.request("POST", "/objects/deals/records/query", {
      body: { filter, limit: 1 },
    });

    return result.data?.[0] ?? null;
  }

  formatSourceValue() {
    const sourceType = process.env.CRM_DEAL_SOURCE_TYPE ?? "select";
    if (sourceType === "text") {
      return [{ value: this.config.dealSourceLinkedIn }];
    }

    return [{ option: this.config.dealSourceLinkedIn }];
  }

  async createDeal({ lead, personRecordId, companyRecordId }) {
    const values = {
      name: [{ value: lead.fullName }],
      [this.config.dealStageAttr]: [{ status: this.config.dealStageInterested }],
      [this.config.dealSourceAttr]: this.formatSourceValue(),
      associated_people: [
        {
          target_object: "people",
          target_record_id: personRecordId,
        },
      ],
    };

    if (companyRecordId) {
      values.associated_company = [
        {
          target_object: "companies",
          target_record_id: companyRecordId,
        },
      ];
    }

    if (this.config.dealOwnerRecordId) {
      values[this.config.dealOwnerAttr] = [
        {
          referenced_actor_type: "workspace-member",
          referenced_actor_id: this.config.dealOwnerRecordId,
        },
      ];
    }

    const result = await this.request("POST", "/objects/deals/records", {
      body: { data: { values } },
    });

    return result.data;
  }

  async addPersonToAttributionList(personRecordId) {
    const result = await this.request(
      "PUT",
      `/lists/${this.config.attributionListSlug}/entries`,
      {
        body: {
          data: {
            parent_record_id: personRecordId,
            parent_object: "people",
            entry_values: {},
          },
        },
      },
    );

    return result.data;
  }

  async listInterestedLinkedInDeals() {
    const filter = {
      $and: [
        { [this.config.dealStageAttr]: this.config.dealStageInterested },
        { [this.config.dealSourceAttr]: this.config.dealSourceLinkedIn },
      ],
    };

    const deals = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const result = await this.request("POST", "/objects/deals/records/query", {
        body: { filter, limit, offset },
      });

      const batch = result.data ?? [];
      deals.push(...batch);

      if (batch.length < limit) {
        break;
      }

      offset += limit;
    }

    return deals;
  }

  async getPersonRecord(recordId) {
    const result = await this.request("GET", `/objects/people/records/${recordId}`);
    return result.data;
  }

  async getCompanyRecord(recordId) {
    const result = await this.request("GET", `/objects/companies/records/${recordId}`);
    return result.data;
  }

  async updateDealLastReminderDay(dealRecordId, reminderDay) {
    const result = await this.request("PATCH", `/objects/deals/records/${dealRecordId}`, {
      body: {
        data: {
          values: {
            [this.config.dealLastReminderAttr]: [{ value: String(reminderDay) }],
          },
        },
      },
    });

    return result.data;
  }

  async pushPositiveLead(lead) {
    const existingPerson = await this.findPersonByLinkedIn(lead.linkedInUrl);
    const person = existingPerson ?? (await this.upsertPerson(lead));
    const personRecordId = this.getRecordId(person);

    if (!personRecordId) {
      throw new Error("Failed to resolve person record ID");
    }

    const company = lead.companyName ? await this.upsertCompany(lead.companyName) : null;
    const companyRecordId = company ? this.getRecordId(company) : null;

    const existingDeal = await this.findExistingInterestedDeal(personRecordId);
    const deal =
      existingDeal ??
      (await this.createDeal({
        lead,
        personRecordId,
        companyRecordId,
      }));

    await this.addPersonToAttributionList(personRecordId);

    return {
      personRecordId,
      companyRecordId,
      dealRecordId: this.getRecordId(deal),
      created: {
        person: !existingPerson,
        company: Boolean(lead.companyName && company),
        deal: !existingDeal,
      },
    };
  }
}

export function createCrmClient(config = getConfig().crm) {
  if (config.provider !== "attio") {
    throw new Error(`Unsupported CRM provider: ${config.provider}`);
  }

  return new AttioClient(config);
}
