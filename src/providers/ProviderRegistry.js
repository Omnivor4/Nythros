export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(name, provider) {
    this.providers.set(name, provider);
  }

  getProvider(name) {
    return this.providers.get(name);
  }

  getAllProviderNames() {
    return Array.from(this.providers.keys());
  }
}
