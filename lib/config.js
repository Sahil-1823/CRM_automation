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
      embeddingModel: optional("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
    },
    heyreach: {
      webhookSecret: optional("HEYREACH_WEBHOOK_SECRET"),
      apiKey: required("HEYREACH_API_KEY"),
      apiBaseUrl: optional("HEYREACH_API_BASE_URL", "https://api.heyreach.io/api/public").replace(
        /\/$/,
        "",
      ),
    },
    vector: {
      url:
        process.env.UPSTASH_VECTOR_REST_URL ||
        process.env.VECTOR_REST_API_URL ||
        "",
      token:
        process.env.UPSTASH_VECTOR_REST_TOKEN ||
        process.env.VECTOR_REST_API_TOKEN ||
        "",
    },
  };
}
