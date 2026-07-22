import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

/**
 * MCPClient — JSON-RPC client for MCP over stdio.
 * Fitur: auto-reconnect 3x exponential backoff kalau server crash.
 * Emits: 'reconnecting', 'reconnected', 'reconnect_failed'
 */
export class MCPClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.proc = null;
    this.name = '';
    this.command = '';
    this.args = [];
    this.idCounter = 1;
    this.pendingRequests = new Map();
    this.buffer = ''; // For Prompt A6 Part 4

    // Auto-reconnect settings
    this.disconnecting = false;
    this.reconnectAttempts = 0;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;

    // Stderr log buffer (max 200 lines per server)
    this.logs = [];
    this.maxLogLines = options.maxLogLines ?? 200;
  }

  async connect(name, command, args) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.disconnecting = false;
    this.reconnectAttempts = 0;
    return this._doConnect();
  }

  /** Internal: spawn process + initialize handshake */
  async _doConnect() {
    return new Promise((resolveConnect, rejectConnect) => {
      try {
        this.proc = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        });
      } catch (err) {
        return rejectConnect(new Error(`[MCP] Gagal spawn proses ${this.name}: ${err.message}`));
      }

      this.proc.on('error', (err) => {
        rejectConnect(new Error(`[MCP] Proses ${this.name} error: ${err.message}`));
      });

      this.proc.on('exit', (code, signal) => this._handleExit(code, signal));
      this.proc.stdout.on('data', (data) => this._handleData(data));
      this.proc.stderr.on('data', (data) => {
        const text = data.toString();
        // Write to stderr for real-time visibility
        process.stderr.write(`[MCP ${this.name} stderr] ${text}`);
        // Buffer for /mcp logs access
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.logs.push(line);
          if (this.logs.length > this.maxLogLines) {
            this.logs.shift();
          }
        }
      });
      this.proc.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE') console.error('[MCP] stdin error:', err);
      });

      this._send({
        jsonrpc: '2.0',
        id: this.idCounter++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'nythros', version: '0.3.0' },
        },
      })
        .then(() => this._send({ jsonrpc: '2.0', method: 'notifications/initialized' }))
        .then(() => resolveConnect())
        .catch((err) => rejectConnect(err));
    });
  }

  /** Handle subprocess exit: reject pending + trigger reconnect */
  _handleExit(code, signal) {
    for (const [, req] of this.pendingRequests.entries()) {
      req.reject(
        new Error(
          `[MCP] Server ${this.name} keluar secara prematur dengan kode ${code} / sinyal ${signal}`,
        ),
      );
      if (req.timeoutId) clearTimeout(req.timeoutId);
    }
    this.pendingRequests.clear();

    // Auto-reconnect if this was NOT an intentional disconnect
    // _scheduleReconnect akan cek maxRetries sendiri
    if (!this.disconnecting) {
      this._scheduleReconnect();
    }
  }

  /** Schedule reconnect with exponential backoff.
   *  IMPORTANT: reconnectAttempts TIDAK di-reset di sini. Hanya connect()
   *  yang reset ke 0. Ini mencegah infinite retry loop untuk server
   *  yang crash terus setelah reconnect (misal server yang exit pas init).
   */
  _scheduleReconnect() {
    // Cek limit SEBELUM increment, supaya pas udah max emit reconnect_failed
    if (this.reconnectAttempts >= this.maxRetries) {
      const msg = `[MCP] Gagal reconnect ke "${this.name}" setelah ${this.maxRetries} percobaan`;
      console.warn(msg);
      this.emit('reconnect_failed', { name: this.name, error: msg });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.retryDelayMs * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[MCP] Reconnect ke "${this.name}" dalam ${delay}ms (${this.reconnectAttempts}/${this.maxRetries})`,
    );
    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      maxRetries: this.maxRetries,
      delay,
      name: this.name,
    });

    setTimeout(async () => {
      // User disconnect saat timeout pending? Cancel
      if (this.disconnecting) return;

      try {
        await this._doConnect();
        // reconnectAttempts TIDAK di-reset — hanya connect() yang reset
        // Ini penting biar server crash-loop gak infinite retry
        console.log(`[MCP] Reconnect berhasil ke "${this.name}"`);
        this.emit('reconnected', { name: this.name });
      } catch (err) {
        console.warn(
          `[MCP] Reconnect ke "${this.name}" gagal (${this.reconnectAttempts}/${this.maxRetries}): ${err.message}`,
        );

        if (!this.disconnecting) {
          // _scheduleReconnect akan cek limit sendiri
          this._scheduleReconnect();
        }
      }
    }, delay);
  }

  async listTools() {
    const res = await this._request('tools/list', {});
    return res.tools;
  }

  async callTool(name, args) {
    const res = await this._request('tools/call', { name, arguments: args });
    return res;
  }

  async _request(method, params, timeoutMs = 30000) {
    const id = this.idCounter++;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new Error(
              `[MCP] Timeout! Server tidak merespon dalam ${timeoutMs}ms untuk metode ${method}`,
            ),
          );
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async _send(msg) {
    if (this.proc && this.proc.stdin) {
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  _handleData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const { resolve, reject, timeoutId } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (timeoutId) clearTimeout(timeoutId);

          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Parse error for this line, ignore silently
      }
    }
  }

  /** Get buffered stderr logs */
  getLogs() {
    return this.logs;
  }

  /** Clear stderr log buffer */
  clearLogs() {
    this.logs = [];
  }

  disconnect() {
    this.disconnecting = true;
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
