import { ServiceContainer } from './ServiceContainer.js';
import { EventBus } from './EventBus.js';

export class Kernel {
  constructor() {
    this.container = new ServiceContainer();
    this.events = new EventBus();
    
    // Register self and event bus
    this.container.register('kernel', this);
    this.container.register('events', this.events);
  }

  async boot() {
    this.events.emit('kernel:booting', { time: Date.now() });
    
    // In a real scenario, this would load providers from config, init DB, etc.
    // Boot sequence will be triggered from runtime/bootstrap.js
    
    this.events.emit('kernel:booted', { time: Date.now() });
  }

  getService(name) {
    return this.container.get(name);
  }
}
