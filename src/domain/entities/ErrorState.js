export class ErrorState {
  constructor() {
    this.failures = [];
  }

  addFailure(message) {
    this.failures.push({ message, timestamp: Date.now() });
  }

  get summary() {
    if (this.failures.length === 0) return null;
    return `Recent failures: ${this.failures.slice(-3).map(f => f.message).join(', ')}`;
  }
  
  get isCircuitOpen() {
    // Basic circuit breaker: 3 failures in last 2 minutes
    const recent = this.failures.filter(f => Date.now() - f.timestamp < 120000);
    return recent.length >= 3;
  }
}
