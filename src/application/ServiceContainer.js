export class ServiceContainer {
  constructor() {
    this.services = new Map();
  }

  register(name, instance) {
    this.services.set(name, instance);
  }

  registerFactory(name, factoryFn) {
    this.services.set(name, { isFactory: true, factoryFn });
  }

  get(name) {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found in container.`);
    }
    if (service.isFactory) {
      return service.factoryFn(this);
    }
    return service;
  }
}
