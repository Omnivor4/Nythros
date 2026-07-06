export class ExecutionEngine {
  constructor(kernel) {
    this.kernel = kernel;
    this.events = kernel.getService('events');
    this.toolExecutor = kernel.getService('toolExecutor');
  }

  async run({ userPrompt, systemPrompt, initialMessages = [], maxTurns = 5, effort = 'Balanced' }) {
    const provider = this.kernel.getService('providerRegistry').getProvider('default');
    const toolRegistry = this.kernel.getService('toolRegistry');
    const activeTools = toolRegistry.getAllTools();
    
    let messages = [...initialMessages, { role: 'user', content: userPrompt }];
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    this.events.emit('execution:start', { prompt: userPrompt });

    for (let turn = 0; turn < maxTurns; turn++) {
      this.events.emit('execution:turn_start', { turn: turn + 1 });

      const requestOptions = {
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        tools: activeTools,
        effort
      };

      const result = await provider.executeRequest(requestOptions);
      messages.push(result.assistantMessage);
      
      if (result.usage) {
        totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += result.usage.completion_tokens || 0;
        totalUsage.total_tokens += result.usage.total_tokens || 0;
      }

      if (!result.toolCalls || result.toolCalls.length === 0) {
        this.events.emit('execution:end', { status: 'success', text: result.textOutput });
        return { text: result.textOutput, messages, usage: totalUsage };
      }

      for (const call of result.toolCalls) {
        this.events.emit('tool:start', { tool: call.name, input: call.input });
        const output = await this.toolExecutor.execute(call);
        this.events.emit('tool:end', { tool: call.name, output });
        
        // Truncate output if necessary
        let safeOutput = String(output);
        if (safeOutput.length > 15000) {
          safeOutput = safeOutput.substring(0, 15000) + "\\n...[OUTPUT TRUNCATED]...";
        }
        
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: safeOutput
        });
      }
    }

    this.events.emit('execution:end', { status: 'max_turns_reached' });
    return { text: "⚠️ Max turns reached without final answer.", messages, usage: totalUsage };
  }
}
