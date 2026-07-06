import test from "node:test";
import assert from "node:assert";
import { loadConfig, saveConfig } from "../src/config.js";
import { syncMcpServers, getMcpTools, getActiveMcpClients } from "../src/agent/mcpLoader.js";

test("MCP Client Flow", async (t) => {
  // Clear any existing MCP servers in config first
  saveConfig({ mcpServers: [] });
  await syncMcpServers();
  
  await t.test("Connect to a local filesystem MCP server", async () => {
    const cmdStr = "npx -y @modelcontextprotocol/server-filesystem .";
    const name = "test-fs";
    const config = loadConfig();
    config.mcpServers = config.mcpServers || [];
    config.mcpServers.push({ name, command: cmdStr });
    saveConfig({ mcpServers: config.mcpServers });
    
    await syncMcpServers();
    
    const active = getActiveMcpClients();
    assert.strictEqual(active.has(name), true, "MCP client should be active");
    
    const tools = getMcpTools();
    assert.ok(tools.length > 0, "Should have loaded at least one tool from filesystem server");
    assert.ok(tools.some(tool => tool.name.startsWith("mcp_test-fs_")), "Tools should be prefixed with server name");
  });

  await t.test("Disconnect MCP server", async () => {
    saveConfig({ mcpServers: [] });
    await syncMcpServers();
    
    const active = getActiveMcpClients();
    assert.strictEqual(active.size, 0, "No MCP clients should remain active");
    
    const tools = getMcpTools();
    assert.strictEqual(tools.length, 0, "Tools list should be empty after disconnect");
  });
});
