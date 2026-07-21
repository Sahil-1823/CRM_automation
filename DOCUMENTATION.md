# CRM Automation Platform — Technical Documentation

> **Interview / resume reference** — end-to-end system design, architecture, pipelines, and Q&A.  
> Project: LinkedIn + Gmail outbound CRM with AI draft replies, RAG knowledge base, human-in-the-loop review, and multi-channel scheduling.

---

## 1. One-line summary (resume)

**Built a serverless CRM automation platform that receives LinkedIn (HeyReach) and Gmail replies, classifies intent with LLMs, retrieves grounded product context via RAG, generates human-like draft replies, and lets operators review/send — with conversation sync, project-scoped knowledge, and channel-specific booking links.**

### Suggested resume bullets

- Designed a **human-in-the-loop sales reply pipeline**: webhook ingest → sentiment/triage → RAG retrieval → LLM draft → dashboard review → send via HeyReach/Gmail APIs.
- Implemented **RAG over product docs** (PDF/DOCX/MD → chunk → OpenAI embeddings → Upstash Vector) with project scoping and citation tracking.
- Built **conversation merge & sync** across webhooks and live inbox APIs so admin chat stays consistent when messages are sent from the dashboard or HeyReach.
- Deployed on **Vercel serverless** with **Upstash Redis/Vector**, cookie session auth, idempotent webhooks, and 90+ automated tests.

---

## 2. Problem statement

Sales teams run LinkedIn outreach (via HeyReach) and email (Gmail). When leads reply:

1. Replies are scattered across tools.
2. Reps need product-accurate answers fast.
3. Blind auto-send is risky (pricing, legal, credentials, unsubscribe).
4. Context (past thread + docs) is hard to keep in one place.

**Solution:** An admin CRM that centralizes conversations, auto-drafts grounded replies, blocks unsafe cases for humans, and sends only after review (or guarded auto-send for Gmail).

---

## 3. High-level architecture

```
┌─────────────────┐     webhook      ┌──────────────────────┐
│  HeyReach       │ ───────────────► │  api/heyreach-webhook │
│  (LinkedIn)     │ ◄── send API ─── │  api/send-reply       │
└─────────────────┘                  └──────────┬───────────┘
                                                │
┌─────────────────┐     Pub/Sub      ┌──────────▼───────────┐
│  Gmail          │ ───────────────► │  api/gmail/webhook    │
│  (OAuth + watch)│ ◄── send API ─── │  api/gmail/send-reply │
└─────────────────┘                  └──────────┬───────────┘
                                                │
                     ┌──────────────────────────┼──────────────────────────┐
                     ▼                          ▼                          ▼
              ┌─────────────┐           ┌─────────────┐            ┌─────────────┐
              │ OpenAI      │           │ Upstash     │            │ Upstash     │
              │ (triage,    │           │ Redis       │            │ Vector      │
              │  draft,     │           │ (events,    │            │ (RAG chunks)│
              │  embeddings)│           │  sessions,  │            └─────────────┘
              └─────────────┘           │  docs meta) │
                                        └──────┬──────┘
                                               ▼
                                        ┌─────────────┐
                                        │ Admin UI    │
                                        │ public/     │
                                        │ index.html  │
                                        └─────────────┘
```

| Layer | Technology |
|-------|------------|
| Runtime | Node.js ≥18, ESM |
| Hosting | Vercel serverless functions (`maxDuration: 60s`) |
| Frontend | Single-page admin dashboard (`public/index.html`) |
| LLM | OpenAI Chat Completions + Embeddings |
| State | Upstash Redis (events, indexes, settings) |
| Vectors | Upstash Vector (RAG) |
| Channels | HeyReach public API + Gmail API (OAuth, history, send) |
| Auth | HMAC-signed cookie session (`hr_session`) |

---

## 4. Core user journey

1. Lead replies on LinkedIn → HeyReach fires webhook.
2. System merges webhook + live inbox history into one thread.
3. LLM **triage**: sentiment + handling category (`conversational`, `info_request`, `scheduling`, `action_required`, `sensitive`, `unsubscribe`, `unclear`).
4. If safe to draft: **RAG** retrieves project/global docs → **LLM draft** (casual LinkedIn tone, citations, grounding flag).
5. If scheduling intent: append **channel booking link** (Calendly for Gmail, custom link for HeyReach).
6. Event appears in sidebar as **Pending review**.
7. Operator edits / **Regenerate** (sync + redraft) / **Send** / **Dismiss**.
8. Send updates HeyReach/Gmail, appends “us” message to thread, bumps event to top of sidebar.

**Safety rule for auto draft:** only generate when the **last message is from the lead**. If last message is from us → sync only, no auto draft. **Regenerate** is a manual override: always available, syncs first, then drafts anyway.

---

## 5. Module map (what each folder does)

### `api/` — HTTP entrypoints (Vercel)

| Route | Role |
|-------|------|
| `heyreach-webhook.js` | Ingest LinkedIn replies; triage; draft; persist events |
| `send-reply.js` | Send approved draft via HeyReach |
| `gmail/webhook.js` | Gmail Pub/Sub push → process history |
| `gmail/send-reply.js` | Send via Gmail API |
| `gmail/oauth.js` | OAuth connect / callback |
| `gmail/accounts.js` | List connected Gmail accounts |
| `cron/renew-gmail-watches.js` | Renew Gmail push watches |
| `auth/login.js`, `logout.js`, `session.js` | Admin login |
| `dashboard/[action].js` | Router for dashboard APIs (events, docs, RAG, sync, regenerate, …) |

### `lib/` — domain logic

| Area | Files | Responsibility |
|------|-------|----------------|
| Conversation | `conversation/index.js`, `sync.js` | Merge threads, dedupe, evaluate inbound, sync all events for a conversationId |
| Draft pipeline | `draft-pipeline.js`, `agent/runner.js`, `reply.js` | Project binding → scheduling → RAG draft |
| Triage | `sentiment.js` | Structured JSON schema classification |
| RAG | `rag.js`, `convert-to-md.js`, `dashboard/documents.js` | Ingest docs, chunk, embed, retrieve |
| Projects | `projects.js`, `channel-project-settings.js` | Knowledge projects + per-channel draft context |
| Scheduling | `scheduling/*` | Calendly (Gmail) vs booking link (HeyReach) |
| Store | `store.js` | Redis/file event store, indexes, serialize for UI |
| HeyReach | `heyreach/client.js`, `meta.js` | Parse webhooks, chatroom fetch, send message |
| Gmail | `gmail/*` | OAuth, parse, prefilter, process, deliver |
| Auth | `auth.js` | HMAC session cookies |

### `public/`

- `index.html` — full CRM UI (sidebar, chat, drafts, knowledge base, analytics)
- `login.html` — admin login

### `test/`

Node.js built-in test runner (`node --test`) — conversation merge, triage, Gmail filters, scheduling, RAG conversion, etc. (~90+ tests).

---

## 6. Data model (events)

Each dashboard “conversation card” is an **event** stored in Redis:

```
crm:events              → [id, id, ...]   (newest-first index)
crm:event:<id>          → event JSON
crm:conv:latest:<cid>   → latest event id for conversation
crm:conv:events:<cid>   → all event ids for conversation
```

**Event shape (conceptual):**

```js
{
  id, channel: "heyreach" | "gmail",
  status: "pending_review" | "sent" | "dismissed" | "auto_resolved",
  createdAt, updatedAt, conversationSyncedAt, sentAt,
  lead: {
    fullName, companyName, jobTitle,
    conversationId, linkedInAccountId,
    replyMessage, yourMessage,
    conversation: [{ from: "lead"|"us", text, at, id? }]
  },
  sentiment: { label, isPositive, reasoning },
  handling: { requiresHuman, category, actionItems, reason },
  draft: {
    reply, rationale, ragSources, citedSources, hasGrounding,
    scheduling, agentTrace, skipped?, error?
  },
  project / draftProjectId,
  campaign, linkedInAccount, gmail: { ... }
}
```

**Design choice:** multiple events can exist per `conversationId` (e.g. old `sent` + new `pending_review` after another lead reply). The **sidebar dedupes by conversationId**, showing only the newest activity.

---

## 7. Pipelines in detail

### 7.1 HeyReach inbound

```
Webhook POST
  → verify secret
  → archive raw payload
  → parseHeyReachPayload
  → fetchEnrichedIncomingThread (inbox API + cache)
  → mergeWebhookConversation (prior Redis + API + webhook)
  → syncAllLeadConversationEvents
  → evaluateInboundWebhook
       • skip if last message from us
       • skip duplicates / already handled
  → classifyReply (LLM triage)
  → if DRAFT_GENERATION_ENABLED: generateDraftForLead(channel: heyreach)
  → saveEvent / updateEvent → pending_review
```

### 7.2 Draft generation (`runDraftAgent` → `generateDraftReply`)

1. Resolve **project** from channel settings (HeyReach → project X, Gmail → project Y) or auto-select.
2. If triage category is **scheduling**, build scheduling payload:
   - Gmail → Calendly link (`CALENDLY_LINK`)
   - HeyReach → custom booking link (`HEYREACH_BOOKING_LINK`)
3. Build RAG query from **last ~2 messages** (focused); rewrite with LLM; retrieve top chunks (score threshold + dedup).
4. Pass **full conversation** + RAG block + style system prompt into OpenAI **JSON schema** response (`reply`, `rationale`, `citedSources`, `hasGrounding`).
5. Append booking link if scheduling mode requires it.

### 7.3 Document → Vector DB (RAG ingest)

```
Upload (base64) / paste
  → convertFileToMarkdown (pdf-parse, mammoth, html/csv/md)
  → preserve/detect headings (DOCX styles, PDF heuristics)
  → chunkText (heading sections → sentence-aware chunks + overlap)
  → OpenAI embeddings (text-embedding-3-small)
  → Upstash Vector upsert (metadata: docId, title, text, projectId)
  → Redis: full markdown + document index
```

### 7.4 Send + sync

**Admin send:** HeyReach/Gmail API → mark `sent` → append “us” message → invalidate chatroom cache → sync sibling events → bump event to front of index.

**HeyReach-side send:** next webhook/poll/sync pulls inbox; may **auto_resolve** stale pending drafts if reply already exists in thread.

**Regenerate (manual override):** sync latest thread → re-triage → generate draft → force `pending_review` (works even if last message is from us).

---

## 8. Human-in-the-loop & safety

| Category | Handling |
|----------|----------|
| conversational, info_request, scheduling | Usually `auto_ok` → draft allowed |
| action_required, sensitive, unsubscribe, unclear | `needs_human` → flag in UI; no unsafe auto-send |
| Negative sentiment | Block Gmail auto-send |

**Gmail auto-send** is optional (`GMAIL_AUTO_SEND_ENABLED`) and still gated by `shouldAutoSend`.

**Idempotency:** webhook deliveries use Redis keys so retries don’t create duplicate pending drafts for the same lead message.

---

## 9. Admin UI features

- Channel tabs: HeyReach / Gmail
- Sidebar: activity-time sort, conversationId dedupe
- Filters: LinkedIn account, campaign, status / needs human
- Chat thread + **Sync from HeyReach**
- Draft editor: Save, Send, Dismiss, **Regenerate draft** (always visible)
- Knowledge base: Projects, Documents upload, channel project bindings
- Analytics, raw webhook debug (ops)

---

## 10. Auth & security

- Edge **middleware** protects UI + APIs except public webhooks/OAuth/cron/auth.
- Single admin user from env (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).
- Session: HMAC-SHA256 cookie, ~7 day expiry, constant-time compare.
- HeyReach webhook secret verification.
- Events **serialized** before UI (strip sensitive internals).

---

## 11. Environment variables (key)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | LLM + embeddings |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `HEYREACH_API_KEY` | Inbox + send |
| `HEYREACH_WEBHOOK_SECRET` | Webhook auth |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Event store |
| `UPSTASH_VECTOR_REST_URL/TOKEN` | RAG |
| `ADMIN_PASSWORD` / `AUTH_SECRET` | Dashboard auth |
| `DRAFT_GENERATION_ENABLED` | Auto draft on inbound |
| `CALENDLY_LINK` | Gmail scheduling |
| `HEYREACH_BOOKING_LINK` | LinkedIn scheduling |
| Gmail OAuth / Pub/Sub vars | Email channel |

---

## 12. Design decisions (talk about these in interviews)

1. **Human-in-the-loop by default** — AI drafts; humans send (unless explicitly enabled auto-send).
2. **Structured outputs** — JSON schema for triage + drafts → reliable parsing.
3. **RAG with grounding flags** — model reports whether it used docs; UI shows citations.
4. **Conversation as source of truth** — merge webhook + API + prior store; don’t trust one source.
5. **Serverless-friendly** — Redis for state, Vector for search, short-lived functions.
6. **Channel-specific scheduling** — different booking UX for LinkedIn vs email.
7. **Fail-safe triage** — unknown → needs_human.
8. **Idempotent webhooks** — production-grade retry safety.

---

## 13. Challenges solved (story bank)

| Challenge | Approach |
|-----------|----------|
| PDF upload broke on Vercel (`DOMMatrix`) | Pin `pdf-parse@1.1.1` (no browser pdf.js) |
| Sidebar didn’t bubble updated chats | Bump index on `updateEvent` + sort by activity time |
| Duplicate cards (sent + pending) | Dedupe sidebar by `conversationId` |
| RAG chunks cut mid-sentence / lost headings | Sentence chunking + DOCX/PDF heading preservation |
| Calendly on LinkedIn unwanted | Separate `HEYREACH_BOOKING_LINK` vs `CALENDLY_LINK` |
| Stale drafts after reply in HeyReach | Auto-resolve pending when thread already replied |

---

## 14. Metrics / scale notes (honest framing)

- Designed for **operator throughput**, not millions of QPS: webhook + async LLM calls per reply.
- Redis index capped (~500 events) for dashboard responsiveness.
- Vector retrieval: topK with score threshold + near-duplicate filter.
- Function timeout 60s for draft + sync paths.

---

## 15. How to run (local)

```bash
npm install
# set env (OpenAI, HeyReach, Upstash, ADMIN_PASSWORD, …)
npm run dev          # vercel dev
npm test             # unit tests
npm run harness      # scenario harness (optional)
```

---

## 16. Interview Q&A

### Fundamentals & product

**Q1. What does this project do?**  
A: It’s a CRM automation layer for LinkedIn (HeyReach) and Gmail. It ingests lead replies, classifies them, retrieves relevant knowledge-base content, drafts a reply, and lets a human review and send.

**Q2. Why not fully auto-send every reply?**  
A: Sales messages can involve pricing, legal, credentials, or unsubscribe requests. We classify risk and default to human review. Optional Gmail auto-send is tightly gated.

**Q3. What is “human-in-the-loop” here?**  
A: The AI proposes a draft with sources and rationale; the operator edits, regenerates, dismisses, or sends. Critical actions stay under human control.

### Architecture

**Q4. Why Vercel + Redis instead of a traditional server + Postgres?**  
A: Workloads are event-driven (webhooks) with bursty LLM latency. Serverless fits. Redis gives fast document-oriented event storage and indexes without managing a DB for this dashboard scale. Vectors live in Upstash Vector.

**Q5. How do you keep chat history consistent across webhook and UI?**  
A: We merge three sources: prior stored thread, HeyReach inbox API (cached), and webhook payload. Sync APIs force-refresh. Sends append outbound messages and invalidate cache.

**Q6. What happens if HeyReach retries the same webhook?**  
A: Idempotency keys claim “first seen”; duplicates sync conversation only and don’t create another pending draft for the same message.

### LLM & RAG

**Q7. Explain your RAG pipeline.**  
A: Docs → Markdown → structural/sentence chunking → embeddings → vector upsert with `projectId` metadata. At draft time we embed a rewritten query, filter by project/global, apply score threshold and dedupe, then inject chunks into the prompt with citation tracking.

**Q8. Why rewrite the search query?**  
A: Raw conversation text is noisy. A short topic query improves embedding retrieval relevance.

**Q9. How do you prevent hallucinations?**  
A: Prompt instructs “use only facts stated in reference material”; model returns `hasGrounding` and `citedSources`; UI surfaces RAG excerpts. Still not perfect—human review is the last line of defense.

**Q10. What model do you use and why?**  
A: Configurable; default `gpt-4o-mini` for cost/latency on triage + drafts; `text-embedding-3-small` for embeddings. Structured JSON schema responses reduce parse failures.

### Conversation & draft rules

**Q11. When is a draft auto-generated?**  
A: When inbound processing decides the latest message is from the lead (awaiting our reply), draft generation is enabled, and triage allows drafting. If the last message is from us, we sync but do not auto-draft.

**Q12. What does Regenerate do?**  
A: Manual override: sync latest conversation → re-triage → generate draft → set status to `pending_review`, even if we spoke last.

**Q13. Why can the same lead appear twice in storage?**  
A: Each actionable reply can create a new pending event while older sent events remain for history. The UI shows one card per conversationId (newest).

### Scheduling

**Q14. How does meeting booking work?**  
A: Triage marks scheduling intent. Gmail drafts append Calendly (`CALENDLY_LINK`). HeyReach drafts append a separate booking URL (`HEYREACH_BOOKING_LINK`). The model is told not to invent times/URLs.

### Security

**Q15. How is the admin dashboard secured?**  
A: Middleware requires a valid HMAC session cookie for UI and private APIs. Webhooks/OAuth/cron stay public with their own secrets. Admin credentials come from environment variables.

**Q16. How do you protect webhook endpoints?**  
A: Shared secret verification for HeyReach; Gmail uses Google Pub/Sub + account binding. Raw payloads can be archived for debugging.

### Trade-offs & improvements

**Q17. What would you improve next?**  
A: Hybrid search (BM25 + vectors), draft feedback loop (edits → fine-tune prompts), lead enrichment (company context), stronger evaluation harness in CI, and optional queue (SQS/Inngest) for long LLM chains.

**Q18. Biggest production bug you fixed?**  
A: Examples: Vercel PDF `DOMMatrix` (pin pdf-parse v1); sidebar sorting/dedupe; channel-specific booking links; conversation merge edge cases when messages arrive from both dashboard and HeyReach.

**Q19. How do you test?**  
A: Node test suite covering merge/dedupe, triage normalization, Gmail prefilters, scheduling append behavior, conversion, etc. Optional scenario harness for end-to-end draft expectations.

**Q20. How would you explain this to a non-engineer?**  
A: When a prospect replies on LinkedIn or email, the system drafts a careful reply using our documents, flags anything that needs a human, and puts it in one inbox for the team to approve and send.

---

## 17. Glossary

| Term | Meaning |
|------|---------|
| HeyReach | LinkedIn outreach / inbox SaaS used as LinkedIn channel |
| Triage | LLM classification of sentiment + handling category |
| RAG | Retrieval-Augmented Generation — draft grounded in uploaded docs |
| Event | One dashboard record (often one inbound reply needing review) |
| Project | Knowledge-base bucket with optional system prompt |
| Grounding | Whether the draft used retrieved doc facts |
| Auto-resolved | Pending draft closed because reply already exists in live thread |

---

## 18. Ownership note for interviews

When discussing this project, be ready to walk through:

1. **Inbound webhook path** (`api/heyreach-webhook.js`)  
2. **Draft agent** (`lib/agent/runner.js` + `lib/reply.js`)  
3. **RAG** (`lib/rag.js`)  
4. **Conversation merge** (`lib/conversation/index.js`)  
5. **One production incident** and how you debugged it  

That depth signals you built the system, not just used it.
