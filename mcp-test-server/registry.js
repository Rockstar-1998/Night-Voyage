/**
 * Tool Registry - Composition-based tool catalog (no inheritance)
 */
function createRegistry() {
  const tools = new Map();

  function register(tool) {
    if (!tool || !tool.name || typeof tool.execute !== 'function') {
      throw new Error(`Invalid tool object: must have name and execute function`);
    }
    tools.set(tool.name, tool);
  }

  function getTools() {
    return Array.from(tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async function callTool(name, args) {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return await tool.execute(args || {});
  }

  function hasTool(name) {
    return tools.has(name);
  }

  return {
    register,
    getTools,
    callTool,
    hasTool,
  };
}

module.exports = { createRegistry };
