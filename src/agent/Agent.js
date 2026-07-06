export class Agent {
  constructor(kernel) {
    this.kernel = kernel;
    this.events = kernel.getService('events');
    this.pipeline = kernel.getService('contextPipeline');
    this.executionEngine = kernel.getService('executionEngine');
  }

  async process(userPrompt, options = {}) {
    const {
      effort = 'Balanced',
      initialMessages = []
    } = options;

    this.events.emit('agent:processing', { prompt: userPrompt });

    try {
      // 1. Build Context
      const context = await this.pipeline.build({
        memory: '',
        skills: [],
        obsidianConnected: false,
        mcpTools: []
      });

      // 2. Build System Prompt from Context
      const systemPrompt = this.buildSystemPromptFromContext(context);

      // 3. Execute
      const result = await this.executionEngine.run({
        userPrompt,
        systemPrompt,
        initialMessages,
        effort
      });

      this.events.emit('agent:done', { result });
      return result;
    } catch (err) {
      this.events.emit('agent:error', { error: err.message });
      throw err;
    }
  }

  buildSystemPromptFromContext(context) {
    // Basic conversion of Context entity to system prompt string.
    // Ideally this uses the SystemPrompt entity.
    let prompt = `You are Nythros, an AI coding agent.
`;
    if (context.memory) {
      prompt += `\nMemory:\n${context.memory}\n`;
    }
    return prompt;
  }
}
