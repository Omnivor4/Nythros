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
        // just log and continue, don't crash
        continue;
      }
    }
    
    try {
      const toolsList = await client.listTools();
      for (const t of toolsList) {
        newTools.push({
          name: `mcp_${srv.name}_${t.name}`,
          description: t.description || `Tool ${t.name} from MCP server ${srv.name}`,
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
      // ignore
    }
  }
  cachedMcpTools = newTools;
  return cachedMcpTools;
}

export function getMcpTools() {
  return cachedMcpTools;
}

export function getActiveMcpClients() {
  return activeMcpClients;
}
