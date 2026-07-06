export class Todo {
  constructor({ tasks = [] }) {
    this.tasks = tasks;
  }
  
  addTask(task) {
    this.tasks.push({ ...task, status: 'pending' });
  }

  updateTask(id, updates) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      Object.assign(task, updates);
    }
  }

  get summary() {
    return this.tasks.map(t => `[${t.status}] ${t.description}`).join("\n");
  }
}
