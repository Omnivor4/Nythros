export class SystemPrompt {
  constructor(baseTemplate) {
    this.baseTemplate = baseTemplate;
    this.sections = new Map();
  }

  addSection(title, content) {
    if (content && content.trim()) {
      this.sections.set(title, content);
    }
  }

  build() {
    let prompt = this.baseTemplate + "\n\n";
    for (const [title, content] of this.sections) {
      prompt += `### ${title}\n${content}\n\n`;
    }
    return prompt.trim();
  }
}
