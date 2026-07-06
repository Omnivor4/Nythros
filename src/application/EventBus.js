export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    
    // return an unsubscribe function
    return () => {
      this.listeners.get(event).delete(callback);
    };
  }

  emit(event, payload) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(payload);
        } catch (error) {
          console.error(`[EventBus] Error in listener for event ${event}:`, error);
        }
      }
    }
  }
}
