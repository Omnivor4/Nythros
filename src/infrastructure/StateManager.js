import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';

export class StateManager {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;

    const stateDir = path.resolve(process.cwd(), '.nythros');
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    const dbPath = path.join(stateDir, 'state.db');
    
    this.db = createClient({
      url: `file:${dbPath}`
    });

    await this.initSchema();
    this.isInitialized = true;
  }

  async initSchema() {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS task_history (
        task_id TEXT PRIMARY KEY,
        status TEXT,
        mode TEXT,
        effort TEXT,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS agent_config (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        message TEXT,
        stack_trace TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async setConfig(key, value) {
    await this.init();
    await this.db.execute({
      sql: 'INSERT INTO agent_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      args: [key, value]
    });
  }

  async getConfig(key, defaultValue = null) {
    await this.init();
    const result = await this.db.execute({
      sql: 'SELECT value FROM agent_config WHERE key = ?',
      args: [key]
    });
    
    if (result.rows.length > 0) {
      return result.rows[0].value;
    }
    return defaultValue;
  }

  async saveTask(taskId, status, mode, effort, context) {
    await this.init();
    await this.db.execute({
      sql: `INSERT INTO task_history (task_id, status, mode, effort, context) 
            VALUES (?, ?, ?, ?, ?) 
            ON CONFLICT(task_id) DO UPDATE SET 
            status=excluded.status, mode=excluded.mode, effort=excluded.effort, context=excluded.context`,
      args: [taskId, status, mode, effort, JSON.stringify(context)]
    });
  }

  async getTask(taskId) {
    await this.init();
    const result = await this.db.execute({
      sql: 'SELECT * FROM task_history WHERE task_id = ?',
      args: [taskId]
    });
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        ...row,
        context: row.context ? JSON.parse(row.context) : null
      };
    }
    return null;
  }

  async logError(taskId, error) {
    await this.init();
    await this.db.execute({
      sql: 'INSERT INTO error_logs (task_id, message, stack_trace) VALUES (?, ?, ?)',
      args: [taskId || 'global', error.message, error.stack || '']
    });
  }
}

