import { getRedis } from "./store.js";
import { getProject } from "./projects.js";

const SETTINGS_KEY = "crm:channel-project-settings";

export const CHANNEL_PROJECT_CHANNELS = ["heyreach", "gmail"];

const DEFAULT_SETTINGS = {
  heyreach: { projectId: "all" },
  gmail: { projectId: "all" },
};

export async function getChannelProjectSettings() {
  const redis = getRedis();
  if (!redis) return { ...DEFAULT_SETTINGS };
  const stored = await redis.get(SETTINGS_KEY);
  return {
    heyreach: { projectId: stored?.heyreach?.projectId ?? "all" },
    gmail: { projectId: stored?.gmail?.projectId ?? "all" },
  };
}

export async function setChannelProjectSettings(patch) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required to save channel project settings");

  const current = await getChannelProjectSettings();
  const next = { ...current };

  for (const channel of CHANNEL_PROJECT_CHANNELS) {
    if (patch[channel] === undefined) continue;
    const projectId = normalizeProjectId(patch[channel]);
    next[channel] = { projectId };
  }

  await redis.set(SETTINGS_KEY, next);
  return next;
}

export function normalizeProjectId(value) {
  const id = String(value ?? "").trim();
  if (!id || id === "all") return "all";
  if (id === "none") return "none";
  return id;
}

/** Resolve stored project id into runDraftAgent binding + event metadata. */
export async function getDraftProjectBindingForChannel(channel) {
  const settings = await getChannelProjectSettings();
  const projectId = settings[channel]?.projectId ?? "all";
  return resolveProjectIdBinding(projectId);
}

export async function resolveProjectIdBinding(projectId) {
  const id = normalizeProjectId(projectId);

  if (id === "none") {
    return {
      projectOverride: null,
      projectScopeOverride: "none",
      draftProjectId: "none",
      project: { id: null, name: "None", source: "channel" },
    };
  }

  if (id === "all") {
    return {
      projectOverride: null,
      projectScopeOverride: "all",
      draftProjectId: "all",
      project: { id: null, name: "All projects", source: "channel" },
    };
  }

  const project = await getProject(id);
  if (!project) {
    return resolveProjectIdBinding("all");
  }

  return {
    projectOverride: project,
    projectScopeOverride: "project",
    draftProjectId: project.id,
    project: { id: project.id, name: project.name, source: "channel" },
  };
}

export async function serializeChannelProjectSettingsForDashboard() {
  const settings = await getChannelProjectSettings();
  const out = {};

  for (const channel of CHANNEL_PROJECT_CHANNELS) {
    const projectId = settings[channel].projectId;
    const binding = await resolveProjectIdBinding(projectId);
    out[channel] = {
      projectId,
      projectName: binding.project.name,
    };
  }

  return out;
}
