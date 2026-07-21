import { loadConfig } from "../../shared/config.js";
import { MCPClient } from "../mcp/client.js";

const activeMcpClients = new Map();
let cachedMcpTools = [];

export async function syncMcpServers() {
  const config = loadConfig();
  const servers = config.mcpServers || [];
  const newTools = [];

  const configNames = new Set(servers.map(s => s.name));
  for (const [name, client] of activeMcpClients.entries()) {
    if (!configNames.has(name)) {
      client.disconnect();
      activeMcpClients.delete(name);
    }
  }

  for (const srv of servers) {
    let client = activeMcpClients.get(srv.name);
    if (!client) {
      try {
        client = new MCPClient();
        // parse command roughly
        // e.g. "npx @modelcontextprotocol/server-filesystem ."
        const match = srv.command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        const parts = match.map(p => p.replace(/^"|"$/g, ""));
        const cmd = parts[0];
        const args = parts.slice(1);
        await client.connect(srv.name, cmd, args);
        activeMcpClients.set(srv.name, client);
      } catch (err) {
        console.warn(`[MCP] Gagal konek ke server "${srv.name}": ${err.message}`);
        continue;
      }
    }
  }

  // Reuse refreshMcpTools untuk listing tools dari semua server aktif
  cachedMcpTools = [];
  await refreshMcpTools();
  return cachedMcpTools;
}

export function getMcpTools() {
  return cachedMcpTools;
}

export function getActiveMcpClients() {
  return activeMcpClients;
}

export async function connectMcpServer(name, commandStr) {
  // disconnect existing if any
  const existing = activeMcpClients.get(name);
  if (existing) {
    existing.disconnect();
    activeMcpClients.delete(name);
  }

  const client = new MCPClient();
  const match = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const parts = match.map(p => p.replace(/^"|"$/g, ""));
  const cmd = parts[0];
  const args = parts.slice(1);
  await client.connect(name, cmd, args);
  activeMcpClients.set(name, client);

  // Refresh cached tools
  await refreshMcpTools();
  return true;
}

export async function disconnectMcpServer(name) {
  const client = activeMcpClients.get(name);
  if (!client) return false;
  client.disconnect();
  activeMcpClients.delete(name);

  // Hapus tools dari server ini
  cachedMcpTools = cachedMcpTools.filter(t => !t.name.startsWith(`mcp_${name}_`));
  return true;
}

export function persistMcpToConfig(name, command) {
  // Dynamic import biar nggak circular dependency
  import('../../shared/config.js').then(({ loadConfig, saveConfig }) => {
    const cfg = loadConfig();
    cfg.mcpServers = cfg.mcpServers || [];
    if (!cfg.mcpServers.some(s => s.name === name)) {
      cfg.mcpServers.push({ name, command });
      saveConfig(cfg);
    }
  }).catch(() => {});
}

export function removeMcpFromConfig(name) {
  import('../../shared/config.js').then(({ loadConfig, saveConfig }) => {
    const cfg = loadConfig();
    cfg.mcpServers = (cfg.mcpServers || []).filter(s => s.name !== name);
    saveConfig(cfg);
  }).catch(() => {});
}

async function refreshMcpTools() {
  const newTools = [];
  for (const [srvName, client] of activeMcpClients) {
    try {
      const toolsList = await client.listTools();
      for (const t of toolsList) {
        newTools.push({
          name: `mcp_${srvName}_${t.name}`,
          description: t.description || `Tool ${t.name} from MCP server ${srvName}`,
          input_schema: t.inputSchema,
          execute: async (input) => {
            try {
              const res = await client.callTool(t.name, input);
              return JSON.stringify(res);
            } catch (err) {
              return `Error calling MCP tool ${t.name}: ${err.message}`;
            }
          }
        });
      }
    } catch (err) {
      console.warn(`[MCP] Gagal refresh tools dari "${srvName}": ${err.message}`);
    }
  }
  cachedMcpTools = newTools;
}
