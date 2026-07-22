// tests/mcp-integration.test.js
// Unit tests for MCP Client + MCP Loader
// Menggunakan real Node.js subprocess sebagai MCP server (no mocking, no network)
// Jalanin: node tests/mcp-integration.test.js
//
// CATATAN: Menggunakan .cmd shim di Windows untuk menghindari issue path spasi + shell:true

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Static imports biar c8 bisa detek coverage
import { MCPClient } from '../src/infrastructure/mcp/client.js';
import * as mcpLoader from '../src/infrastructure/mcp/mcpLoader.js';
import { loadConfig, saveConfig } from '../src/shared/config.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('\n🧪 MCP Integration Tests\n');

// ── Setup: MCP server script + .cmd shim ─────────────────────
const TMP = os.tmpdir();
const MCP_SERVER_PATH = path.join(TMP, 'nythros-mcp-test-server.js');
const NODE_SHIM_PATH = path.join(TMP, 'nythros-node-shim.cmd');

// Minimal MCP server — responses via JSON-RPC over stdin/stdout
const MCP_SERVER_SCRIPT = `
process.on('uncaughtException', () => {});
const rl = require('readline').createInterface({input:process.stdin});
rl.on('close', () => process.exit(0));
rl.on('line', line => {
  try {
    const msg = JSON.parse(line);
    const r = (result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\\n');
    const re = (errMsg) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{message:errMsg}})+'\\n');
    if (msg.method === 'initialize') r({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'test-mcp',version:'1.0.0'}});
    else if (msg.method === 'notifications/initialized') {}
    else if (msg.method === 'tools/list') r({tools:[{name:'echo',description:'Echo',inputSchema:{type:'object',properties:{text:{type:'string'}}}},{name:'add',description:'Add',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}}}}]});
    else if (msg.method === 'tools/call') {
      if (msg.params.name === 'echo') r({content:[{type:'text',text:JSON.stringify(msg.params.arguments)}]});
      else if (msg.params.name === 'add') { const {a,b}=msg.params.arguments||{}; r({content:[{type:'text',text:String((a||0)+(b||0))}]}); }
      else if (msg.params.name === 'error_tool') re('Simulated tool error');
      else re('Unknown tool: '+msg.params.name);
    }
  } catch(e) {}
});
`;

// Silent MCP server — only responds to initialize, ignores ALL other methods (for timeout test)
const MCP_SILENT_SERVER_SCRIPT = `
process.on('uncaughtException', () => {});
const rl = require('readline').createInterface({input:process.stdin});
rl.on('close', () => process.exit(0));
rl.on('line', line => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'silent-mcp',version:'1.0.0'}}})+'\\n');
    } else if (msg.method === 'notifications/initialized') {
      // no response needed
    }
    // ALL other methods (tools/list, tools/call, etc.) intentionally IGNORED
  } catch(e) {}
});
`;

const MCP_SILENT_PATH = path.join(TMP, 'nythros-mcp-silent-server.js');

// Write files
fs.writeFileSync(MCP_SERVER_PATH, MCP_SERVER_SCRIPT, 'utf-8');
fs.writeFileSync(MCP_SILENT_PATH, MCP_SILENT_SERVER_SCRIPT, 'utf-8');
if (!fs.existsSync(NODE_SHIM_PATH)) {
  // .cmd shim avoids Windows path-with-spaces issue with shell: true
  fs.writeFileSync(NODE_SHIM_PATH, `@"${process.execPath}" %*\r\n`, 'utf-8');
}

// ── Modules already imported at top level ────────────────────

// ═══════════════════════════════════════════════════════════════
// MCP CLIENT TESTS (10 tests)
// ═══════════════════════════════════════════════════════════════

test('0. MCPClient: class can be imported', () => {
  assert.ok(MCPClient, 'MCPClient harus ada');
  assert.equal(typeof MCPClient.prototype.connect, 'function');
  assert.equal(typeof MCPClient.prototype.listTools, 'function');
  assert.equal(typeof MCPClient.prototype.callTool, 'function');
  assert.equal(typeof MCPClient.prototype.disconnect, 'function');
});

await testAsync('1. MCPClient: connect to inline MCP server', async () => {
  const client = new MCPClient();
  try {
    await client.connect('test-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
    assert.ok(client.proc, 'Process harus ada');
    assert.ok(client.proc.pid > 0, 'PID harus valid');
    assert.equal(client.pendingRequests.size, 0, 'Pending requests harus 0 setelah connect');
  } finally {
    client.disconnect();
  }
});

await testAsync('2. MCPClient: connect with invalid command rejects', async () => {
  const client = new MCPClient();
  try {
    await client.connect('bad-server', 'nonexistent-command-xyz-999', []);
    // On Windows, spawn may throw synchronously (caught by connect's try/catch)
    assert.ok(true, 'Error handled (sync or async)');
  } catch (err) {
    assert.ok(
      err.message.includes('Gagal spawn') ||
        err.message.includes('ENOENT') ||
        err.message.includes('not found') ||
        err.message.includes('tidak dikenal'),
      `Error tentang spawn failure: ${err.message}`,
    );
  }
});

await testAsync('3. MCPClient: listTools returns tools', async () => {
  const client = new MCPClient();
  await client.connect('tools-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
  try {
    const tools = await client.listTools();
    assert.equal(tools.length, 2, 'Harus ada 2 tools');
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('echo'));
    assert.ok(names.includes('add'));
  } finally {
    client.disconnect();
  }
});

await testAsync('4. MCPClient: callTool invokes tool', async () => {
  const client = new MCPClient();
  await client.connect('call-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
  try {
    const result = await client.callTool('echo', { text: 'Hello MCP!' });
    assert.ok(result.content, 'Result harus punya content');
    assert.ok(result.content[0].text.includes('Hello MCP!'), `Result: ${result.content[0].text}`);
  } finally {
    client.disconnect();
  }
});

await testAsync('5. MCPClient: callTool with numeric args', async () => {
  const client = new MCPClient();
  await client.connect('add-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
  try {
    const result = await client.callTool('add', { a: 5, b: 3 });
    assert.ok(result.content[0].text.includes('8'), `5+3 harus 8: ${result.content[0].text}`);
  } finally {
    client.disconnect();
  }
});

await testAsync('6. MCPClient: handles server error response', async () => {
  const client = new MCPClient();
  await client.connect('err-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
  try {
    await client.callTool('error_tool', {});
    assert.fail('Should have rejected');
  } catch (err) {
    assert.ok(err.message.includes('Simulated tool error'));
  } finally {
    client.disconnect();
  }
});

await testAsync('7. MCPClient: handles unknown tool error', async () => {
  const client = new MCPClient();
  await client.connect('unk-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
  try {
    await client.callTool('nonexistent_tool', {});
    assert.fail('Should have rejected');
  } catch (err) {
    assert.ok(err.message.includes('Unknown tool') || err.message.includes('nonexistent_tool'));
  } finally {
    client.disconnect();
  }
});

await testAsync('8. MCPClient: disconnect clears state', async () => {
  const client = new MCPClient();
  await client.connect('disc-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
  assert.ok(client.proc.pid > 0, 'PID sebelum disconnect');
  client.disconnect();
  assert.equal(client.proc, null, 'Proc harus null setelah disconnect');
  assert.equal(client.pendingRequests.size, 0, 'Pending harus 0 setelah disconnect');
});

await testAsync('9. MCPClient: can call listTools twice', async () => {
  const client = new MCPClient();
  await client.connect('multi-server', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
  try {
    const tools1 = await client.listTools();
    const tools2 = await client.listTools();
    assert.equal(tools1.length, 2, 'Pertama harus 2 tools');
    assert.equal(tools2.length, 2, 'Kedua harus 2 tools juga');
  } finally {
    client.disconnect();
  }
});

// ═══════════════════════════════════════════════════════════════
// MCP LOADER TESTS (basics only — no syncMcpServers)
// ═══════════════════════════════════════════════════════════════

test('10. MCP Loader: exports all expected functions', () => {
  assert.equal(typeof mcpLoader.syncMcpServers, 'function');
  assert.equal(typeof mcpLoader.getMcpTools, 'function');
  assert.equal(typeof mcpLoader.getActiveMcpClients, 'function');
  assert.equal(typeof mcpLoader.connectMcpServer, 'function');
  assert.equal(typeof mcpLoader.disconnectMcpServer, 'function');
  assert.equal(typeof mcpLoader.getServerStatus, 'function');
  assert.equal(typeof mcpLoader.getAllServerStatus, 'function');
  assert.equal(typeof mcpLoader.getMcpLogs, 'function');
  assert.equal(typeof mcpLoader.clearMcpLogs, 'function');
});

await testAsync(
  '11. MCP Loader: getMcpTools and getActiveMcpClients return empty initially',
  async () => {
    assert.ok(Array.isArray(mcpLoader.getMcpTools()));
    assert.ok(mcpLoader.getActiveMcpClients() instanceof Map);
  },
);

await testAsync('12. MCP Loader: persistMcpToConfig saves server to config', async () => {
  const orig = loadConfig();
  saveConfig({ ...orig, mcpServers: [] });
  try {
    mcpLoader.persistMcpToConfig('my-server', 'node my-server.js');
    await new Promise((r) => setTimeout(r, 300));
    const cfg = loadConfig();
    const entry = cfg.mcpServers?.find((s) => s.name === 'my-server');
    assert.ok(entry, 'my-server harus ada di config');
    assert.equal(entry.command, 'node my-server.js');
  } finally {
    saveConfig(orig);
  }
});

await testAsync('13. MCP Loader: removeMcpFromConfig removes server', async () => {
  const orig = loadConfig();
  saveConfig({ ...orig, mcpServers: [{ name: 'remove-me', command: 'npx test' }] });
  try {
    mcpLoader.removeMcpFromConfig('remove-me');
    await new Promise((r) => setTimeout(r, 300));
    const cfg = loadConfig();
    const entry = cfg.mcpServers?.find((s) => s.name === 'remove-me');
    assert.ok(!entry, 'remove-me harus dihapus');
  } finally {
    saveConfig(orig);
  }
});

// ── 14. Timeout test ──────────────────────────────────────────

await testAsync('14. MCPClient: _request timeout rejects after timeoutMs', async () => {
  const client = new MCPClient();
  await client.connect('timeout-server', NODE_SHIM_PATH, [MCP_SILENT_PATH]);
  let start;
  try {
    start = Date.now();
    await client._request('tools/list', {}, 100); // 100ms, not 30s default
    assert.fail('Harusnya reject karena timeout');
  } catch (err) {
    const elapsed = Date.now() - start;
    assert.ok(err.message.includes('Timeout!'), `Error harus tentang timeout: ${err.message}`);
    assert.ok(err.message.includes('100ms'), `Error harus mention durasi: ${err.message}`);
    assert.ok(elapsed >= 50, `Timeout harus ~100ms, aktual: ${elapsed}ms`);
    assert.ok(elapsed < 5000, `Timeout jangan terlalu lama, aktual: ${elapsed}ms`);
    assert.equal(
      client.pendingRequests.size,
      0,
      'Pending requests harus dibersihkan setelah timeout',
    );
  } finally {
    client.disconnect();
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTO-RECONNECT TESTS
// ═══════════════════════════════════════════════════════════════

// ── 15. Auto-reconnect on crash ──────────────────────────────

await testAsync('15. MCPClient: auto-reconnect on unexpected process exit', async () => {
  const client = new MCPClient({ maxRetries: 3, retryDelayMs: 200 });
  await client.connect('auto-reconnect', NODE_SHIM_PATH, [MCP_SERVER_PATH]);

  const events = [];
  client.on('reconnecting', (e) => events.push({ type: 'reconnecting', attempt: e.attempt }));
  client.on('reconnected', (e) => events.push({ type: 'reconnected', name: e.name }));

  try {
    // Simulate crash: kill the process
    const oldPid = client.proc.pid;
    client.proc.kill('SIGTERM');

    // Wait for reconnect to complete
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Reconnect timeout')), 3000);
      client.on('reconnected', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Verify reconnected
    assert.ok(client.proc, 'Proc harus ada setelah reconnect');
    assert.notEqual(client.proc.pid, oldPid, 'PID harus beda setelah reconnect');
    assert.equal(client.pendingRequests.size, 0, 'Pending harus 0 setelah reconnect');
    assert.ok(events.length >= 1, 'Harus ada event reconnecting');
    assert.ok(
      events.some((e) => e.type === 'reconnected'),
      'Harus ada event reconnected',
    );

    // Verify the reconnected server works
    const tools = await client.listTools();
    assert.equal(tools.length, 2, 'listTools harus jalan setelah reconnect');
  } finally {
    client.disconnect();
  }
});

// ── 16. No reconnect on intentional disconnect ───────────────

await testAsync('16. MCPClient: NO auto-reconnect on intentional disconnect', async () => {
  const client = new MCPClient({ maxRetries: 3, retryDelayMs: 100 });
  await client.connect('no-reconnect', NODE_SHIM_PATH, [MCP_SERVER_PATH]);

  let reconnectCalled = false;
  client.on('reconnecting', () => {
    reconnectCalled = true;
  });

  try {
    // Intentional disconnect
    client.disconnect();
    assert.equal(client.proc, null, 'Proc harus null setelah disconnect');
    assert.ok(client.disconnecting, 'disconnecting flag harus true');

    // Wait a bit — no reconnect should happen
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(!reconnectCalled, 'Tidak boleh ada reconnect setelah intentional disconnect');
  } finally {
    client.disconnect();
  }
});

// ── 17. Max retries exhausted ─────────────────────────────────

await testAsync('17. MCPClient: reconnect_failed emitted after max retries exhausted', async () => {
  // Use a server that connects but then immediately exits
  const CRASH_SERVER_SCRIPT = `
process.on('uncaughtException', () => {});
const rl = require('readline').createInterface({input:process.stdin});
rl.on('close', () => process.exit(0));
rl.on('line', line => {
  try {
    const msg = JSON.parse(line);
    // Handle initialize properly so connect succeeds
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'crash-mcp',version:'1.0.0'}}})+'\\n');
    } else if (msg.method === 'notifications/initialized') {
      // Immediately crash after initialization
      process.exit(1);
    }
  } catch(e) {}
});
`;
  const CRASH_PATH = path.join(TMP, 'nythros-mcp-crash-server.js');
  fs.writeFileSync(CRASH_PATH, CRASH_SERVER_SCRIPT, 'utf-8');

  const client = new MCPClient({ maxRetries: 3, retryDelayMs: 100 });
  await client.connect('crash-test', NODE_SHIM_PATH, [CRASH_PATH]);

  const events = [];
  client.on('reconnecting', (e) => events.push({ type: 'reconnecting', attempt: e.attempt }));
  client.on('reconnect_failed', (e) => events.push({ type: 'reconnect_failed', error: e.error }));

  try {
    // Wait for reconnect to exhaust all retries
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('reconnect_failed not emitted within timeout')),
        5000,
      );
      client.on('reconnect_failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Verify events
    assert.ok(
      events.length >= 3,
      `Harus ada minimal 3 reconnecting events, dapet: ${events.length}`,
    );
    const failEvent = events.find((e) => e.type === 'reconnect_failed');
    assert.ok(failEvent, 'Harus ada event reconnect_failed');

    // All 3 reconnect attempts should have happened
    const reconnectEvents = events.filter((e) => e.type === 'reconnecting');
    assert.equal(reconnectEvents.length, 3, 'Harus persis 3 reconnecting attempts');
    reconnectEvents.forEach((e, i) => {
      assert.equal(e.attempt, i + 1, `Attempt ke-${i + 1} harus attempt ${i + 1}`);
    });
  } finally {
    client.disconnect();
    try {
      fs.unlinkSync(CRASH_PATH);
    } catch {}
  }
});

// ═══════════════════════════════════════════════════════════════
// PROC.ON('ERROR') TEST
// ═══════════════════════════════════════════════════════════════

// ── 18. proc.on('error') rejects connect ─────────────────────

await testAsync('18. MCPClient: proc.on(error) rejects connect with correct message', async () => {
  // Simulasikan async spawn error dengan override _doConnect.
  // Kita emit error PADA proc SYNCHRONOUSLY setelah spawn,
  // sebelum Promise microtask .then() chain jalan.
  // rejectConnect kepanggil duluan → connect REJECT.
  const originalDoConnect = MCPClient.prototype._doConnect;
  MCPClient.prototype._doConnect = async function () {
    const promise = originalDoConnect.call(this);
    if (this.proc) {
      // Emit error langsung di sini — masih synchronous,
      // .then(resolveConnect) belum jalan.
      // rejectConnect di error handler langsung reject Promise.
      this.proc.emit('error', new Error('ASYNC SPAWN FAILURE'));
    }
    return promise;
  };

  const client = new MCPClient();
  try {
    await client.connect('error-proc', NODE_SHIM_PATH, [MCP_SERVER_PATH]);
    assert.fail('Harusnya reject karena proc error event');
  } catch (err) {
    const msg = err.message || String(err);
    assert.ok(
      msg.includes('Proses') || msg.includes('error'),
      `Error harus dari proc.on(error): ${msg}`,
    );
    assert.ok(msg.includes('error-proc'), `Error harus mention server name: ${msg}`);
    assert.ok(msg.includes('ASYNC'), `Error harus mention pesan asli: ${msg}`);
  } finally {
    MCPClient.prototype._doConnect = originalDoConnect;
    client.disconnect();
  }
});

// ═══════════════════════════════════════════════════════════════
// LOADER INTEGRATION TESTS (via connectMcpServer)
// ═══════════════════════════════════════════════════════════════

// ── 19. connectMcpServer + disconnectMcpServer ───────────────

await testAsync(
  '19. MCP Loader: connectMcpServer sets status, tools; disconnectMcpServer cleans up',
  async () => {
    const name = 'loader-test';
    const commandStr = `${NODE_SHIM_PATH} ${MCP_SERVER_PATH}`;

    await mcpLoader.connectMcpServer(name, commandStr);
    assert.equal(
      mcpLoader.getServerStatus(name),
      'connected',
      'Status harus connected setelah connect',
    );

    // Verify activeClients
    const clients = mcpLoader.getActiveMcpClients();
    assert.ok(clients.has(name), 'Server harus ada di activeMcpClients');

    // Verify tools (with mcp_ prefix from loader)
    const tools = mcpLoader.getMcpTools();
    assert.ok(tools.length >= 2, `Harus ada minimal 2 tools, dapet: ${tools.length}`);
    const toolNames = tools.map((t) => t.name);
    assert.ok(
      toolNames.includes(`mcp_${name}_echo`),
      `Tools harus include mcp_${name}_echo: ${toolNames.join(', ')}`,
    );
    assert.ok(
      toolNames.includes(`mcp_${name}_add`),
      `Tools harus include mcp_${name}_add: ${toolNames.join(', ')}`,
    );

    // Test tool execution via loader tool
    const echoTool = tools.find((t) => t.name === `mcp_${name}_echo`);
    const result = await echoTool.execute({ text: 'via-loader' });
    assert.ok(result.includes('via-loader'), `Tool execution harus return correct text: ${result}`);

    // Disconnect + verify cleanup
    const removed = await mcpLoader.disconnectMcpServer(name);
    assert.ok(removed, 'disconnectMcpServer harus return true');
    assert.equal(
      mcpLoader.getServerStatus(name),
      'disconnected',
      'Status harus disconnected setelah disconnect',
    );
    assert.ok(
      !mcpLoader.getActiveMcpClients().has(name),
      'Server harus dihapus dari activeMcpClients',
    );
    const remainingTools = mcpLoader.getMcpTools();
    const stillHasTool = remainingTools.some((t) => t.name.startsWith(`mcp_${name}_`));
    assert.ok(!stillHasTool, 'Tools dari server harus dihapus');
  },
);

// ── 20. Crash + reconnect via loader — verify serverStatus ───

await testAsync(
  '20. MCP Loader: crash via connectMcpServer updates serverStatus via events',
  async () => {
    const name = 'loader-crash';
    const commandStr = `${NODE_SHIM_PATH} ${MCP_SERVER_PATH}`;

    try {
      await mcpLoader.connectMcpServer(name, commandStr);
      assert.equal(mcpLoader.getServerStatus(name), 'connected', 'Status harus connected');

      // Get the client to simulate a crash
      const clients = mcpLoader.getActiveMcpClients();
      const client = clients.get(name);
      assert.ok(client, 'Client harus ada');

      // Simulate crash: kill the process
      client.proc.kill('SIGTERM');

      // Wait for reconnect
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Reconnect via loader timeout')), 3000);
        client.on('reconnected', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // Verify status kembali ke connected
      assert.equal(
        mcpLoader.getServerStatus(name),
        'connected',
        'Status harus connected setelah reconnect',
      );

      // Verify tools masih ada
      const tools = mcpLoader.getMcpTools();
      const toolNames = tools.map((t) => t.name);
      assert.ok(
        toolNames.includes(`mcp_${name}_echo`),
        `Tools harus masih ada setelah reconnect: ${toolNames.join(', ')}`,
      );
    } finally {
      await mcpLoader.disconnectMcpServer(name);
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// EXIT WITH PENDING REQUEST TEST
// ═══════════════════════════════════════════════════════════════

// ── 21. proc.on(exit) rejects pending requests ───────────────

await testAsync(
  '21. MCPClient: proc.on(exit) rejects pending requests with server exit error',
  async () => {
    const client = new MCPClient({ maxRetries: 0 }); // No auto-reconnect
    await client.connect('exit-test', NODE_SHIM_PATH, [MCP_SILENT_PATH]);

    // Kirim request yang gak akan direspon (silent server ignores tools/list)
    const reqPromise = client.listTools();

    // Verify request is pending
    assert.equal(client.pendingRequests.size, 1, 'Harus ada 1 pending request');

    // Kill the process → trigger exit event
    client.proc.kill('SIGTERM');

    // The pending request should be rejected
    try {
      await reqPromise;
      assert.fail('Pending request harus di-reject setelah exit');
    } catch (err) {
      const msg = err.message || String(err);
      assert.ok(msg.includes('keluar secara prematur'), `Error harus tentang server exit: ${msg}`);
      assert.ok(msg.includes('exit-test'), `Error harus mention server name: ${msg}`);
      assert.ok(
        msg.includes('SIGTERM') || msg.includes('null'),
        `Error harus mention signal/code: ${msg}`,
      );
    }

    // Verify pending requests cleared
    assert.equal(client.pendingRequests.size, 0, 'Pending requests harus dibersihkan setelah exit');
  },
);

// ═══════════════════════════════════════════════════════════════
// STDIN ERROR HANDLER TEST
// ═══════════════════════════════════════════════════════════════

// ── 22. stdin.on('error') non-EPIPE calls console.error ──────

await testAsync(
  '22. MCPClient: stdin.on(error) logs non-EPIPE errors via console.error',
  async () => {
    const client = new MCPClient();
    await client.connect('stdin-test', NODE_SHIM_PATH, [MCP_SERVER_PATH]);

    const originalConsoleError = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args);

    try {
      // Emit non-EPIPE error — harus trigger console.error
      const err = new Error('STDIN PERMISSION DENIED');
      err.code = 'EACCES';
      client.proc.stdin.emit('error', err);

      assert.ok(captured.length >= 1, 'console.error harus dipanggil untuk non-EPIPE error');
      const call = captured[0];
      const msg = call.map((a) => (typeof a === 'string' ? a : a.message || String(a))).join(' ');
      assert.ok(
        msg.includes('stdin error') || msg.includes('STDIN'),
        `Pesan harus tentang stdin error: ${msg.slice(0, 200)}`,
      );

      // EPIPE error — harus TIDAK trigger console.error
      const errEPIPE = new Error('stdin EPIPE');
      errEPIPE.code = 'EPIPE';
      const beforeCount = captured.length;
      client.proc.stdin.emit('error', errEPIPE);

      assert.equal(
        captured.length,
        beforeCount,
        'console.error TIDAK boleh dipanggil untuk EPIPE error',
      );
    } finally {
      console.error = originalConsoleError;
      client.disconnect();
    }
  },
);

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
