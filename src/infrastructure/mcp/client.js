import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export class MCPClient extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.idCounter = 1;
    this.pendingRequests = new Map();
    this.buffer = ""; // For Prompt A6 Part 4
  }

  async connect(name, command, args) {
    return new Promise((resolveConnect, rejectConnect) => {
      try {
        this.proc = spawn(command, args, { 
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32"
        });
      } catch (err) {
        return rejectConnect(new Error(`[MCP] Gagal spawn proses ${name}: ${err.message}`));
      }

      // Prompt A6 Part 3: error listener
      this.proc.on('error', (err) => {
        rejectConnect(new Error(`[MCP] Proses ${name} error: ${err.message}`));
      });

      // Prompt A6 Part 3: exit listener
      this.proc.on('exit', (code, signal) => {
        for (const [id, req] of this.pendingRequests.entries()) {
          req.reject(new Error(`[MCP] Server ${name} keluar secara prematur dengan kode ${code} / sinyal ${signal}`));
          if (req.timeoutId) clearTimeout(req.timeoutId);
        }
        this.pendingRequests.clear();
      });

      this.proc.stdout.on("data", (data) => this._handleData(data));
      this.proc.stderr.on("data", (data) => process.stderr.write(`[MCP ${name} stderr] ${data}`));

      this._send({
        jsonrpc: "2.0",
        id: this.idCounter++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "nythros", version: "0.3.0" },
        },
      }).then(() => {
        return this._send({ jsonrpc: "2.0", method: "notifications/initialized" });
      }).then(() => {
        resolveConnect();
      }).catch(err => rejectConnect(err));
    });
  }

  async listTools() {
    const res = await this._request("tools/list", {});
    return res.tools;
  }

  async callTool(name, args) {
    const res = await this._request("tools/call", { name, arguments: args });
    return res;
  }

  async _request(method, params, timeoutMs = 30000) {
    const id = this.idCounter++;
    return new Promise((resolve, reject) => {
      // Prompt A6 Part 1: Timeout for requests
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`[MCP] Timeout! Server tidak merespon dalam ${timeoutMs}ms untuk metode ${method}`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async _send(msg) {
    if (this.proc && this.proc.stdin) {
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    }
  }

  _handleData(data) {
    // Prompt A6 Part 4: Buffer management for broken JSON chunks
    this.buffer += data.toString();
    const lines = this.buffer.split("\n");
    
    // The last element is either an empty string (if it ended with \n)
    // or an incomplete chunk. Save it back to the buffer.
    this.buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const { resolve, reject, timeoutId } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (timeoutId) clearTimeout(timeoutId);

          // Prompt A6 Part 2: Handle msg.error explicitly
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {
        // Parse error for this line, ignore silently
      }
    }
  }

  disconnect() {
    if (this.proc) this.proc.kill();
  }
}
