import OpenAI from "openai";
import { getRedis } from "./store.js";
import { getConfig } from "./config.js";
import { reassignDocumentsProject } from "./rag.js";

const PROJECTS_KEY = "crm:projects";

function newProjectId() {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listProjects() {
  const redis = getRedis();
  if (!redis) return [];
  return (await redis.get(PROJECTS_KEY)) || [];
}

export async function getProject(id) {
  if (!id || id === "global") return null;
  const projects = await listProjects();
  return projects.find((p) => p.id === id) || null;
}

export async function createProject({ name, description = "", systemPrompt = "" }) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required to create projects");
  const trimName = name?.trim();
  if (!trimName) throw new Error("Project name is required");

  const projects = await listProjects();
  const project = {
    id: newProjectId(),
    name: trimName,
    description: description.trim(),
    systemPrompt: systemPrompt.trim(),
    createdAt: new Date().toISOString(),
  };
  projects.unshift(project);
  await redis.set(PROJECTS_KEY, projects);
  return project;
}

export async function updateProject(id, { name, description, systemPrompt }) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required");
  const projects = await listProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Project not found: ${id}`);
  const p = projects[idx];
  projects[idx] = {
    ...p,
    name: name !== undefined ? name.trim() : p.name,
    description: description !== undefined ? description.trim() : p.description,
    systemPrompt: systemPrompt !== undefined ? systemPrompt.trim() : p.systemPrompt,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(PROJECTS_KEY, projects);
  return projects[idx];
}

export async function deleteProject(id) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required");
  const projects = await listProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) throw new Error(`Project not found: ${id}`);
  const reassigned = await reassignDocumentsProject(id, "global");
  await redis.set(PROJECTS_KEY, filtered);
  return { deleted: id, reassignedDocuments: reassigned.moved || 0 };
}

/**
 * Use LLM to select the most relevant project for an incoming conversation.
 * Returns the matching project object, or null if no good match / no projects.
 */
export async function selectProject(conversationContext, projects) {
  if (!projects?.length) return null;
  if (projects.length === 1) return projects[0];

  const { openai } = getConfig();
  const client = new OpenAI({ apiKey: openai.apiKey });

  const projectList = projects
    .map(
      (p, i) =>
        `${i + 1}. ID: ${p.id}\n   Name: ${p.name}\n   Description: ${p.description || "No description"}`,
    )
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model: openai.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You select the most relevant knowledge-base project for a LinkedIn sales conversation. " +
          'Reply with JSON: { "projectId": "<id or null>", "reason": "<one sentence>" }. ' +
          "Set projectId to null if no project is a clearly good fit.",
      },
      {
        role: "user",
        content: `Available projects:\n${projectList}\n\nConversation context:\n${conversationContext.slice(0, 800)}\n\nWhich project best matches this conversation?`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(resp.choices[0].message.content);
    return projects.find((p) => p.id === parsed.projectId) || null;
  } catch {
    return null;
  }
}
