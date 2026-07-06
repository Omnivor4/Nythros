export class ToolExecutor {
  constructor(kernel) {
    this.kernel = kernel;
  }

  async execute(toolCall) {
    const registry = this.kernel.getService('toolRegistry');
    const tool = registry.getTool(toolCall.name);

    if (!tool) {
      return `Error: tool "${toolCall.name}" not found.`;
    }

    try {
      // Lazy load dependencies if the tool has a loader
      if (typeof tool.loadDependencies === 'function') {
        await tool.loadDependencies();
      }

      let inputArgs = toolCall.input;
      if (typeof inputArgs === 'string') {
        try {
          inputArgs = JSON.parse(inputArgs);
        } catch (e) {
          // keep as string if parse fails
        }
      }

      return await tool.execute(inputArgs);
    } catch (err) {
      return `Error executing tool "${toolCall.name}": ${err.message}`;
    }
  }
}
