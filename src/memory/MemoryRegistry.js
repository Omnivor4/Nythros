export class MemoryRegistry {
  constructor() {
    this.memories = new Map();
  }

  register(key, memoryItem) {
    this.memories.set(key, memoryItem);
  }

  getMemory(key) {
    return this.memories.get(key);
  }
}
