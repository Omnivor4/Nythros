export class Context {
  constructor({ memory = "", skills = [], obsidianConnected = false, mcpTools = [] }) {
    this.memory = memory;
    this.skills = skills;
    this.obsidianConnected = obsidianConnected;
    this.mcpTools = mcpTools;
  }
}
