const tools = new Map();

export function registerTool(name, { description, parameters, handler }) {
  tools.set(name, { name, description, parameters, handler });
}

export function getRegisteredTools() {
  return [...tools.values()];
}

export async function invokeTool(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(args || {});
}
