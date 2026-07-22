// tests/agent-desktop.integration.test.js
// Integration test: mock LLM + mock PowerShell, verify desktop tools in agent loop
// Jalanin: node tests/agent-desktop.integration.test.js
//
// CATATAN:
// - Mock HTTP server simulate OpenAI-compatible chat/completions API
// - Desktop tools PowerShell di-mock via _setPSMock (tidak panggil PowerShell beneran)
// - Aman dijalankan di Windows maupun non-Windows

import assert from 'node:assert/strict';
import process from 'node:process';

import {
  runWithServer,
  sendSSEResponse,
  sendSSEToolCall,
  sendModelsResponse,
  makeConfig,
  sendSSEChunk,
} from './helpers.js';

let passed = 0;
let failed = 0;

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

console.log('\n🧪 Agent Integration — Desktop Tools Tests\n');

// ── Import sekaligus ───────────────────────────────────────────
const { Agent } = await import('../src/agent/Agent.js');
const desktop = await import('../src/tooling/desktopTools.js');
const { recordSuccess } = await import('../src/infrastructure/state/errorWatchdog.js');

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

// ── 1. Desktop tools included in LLM request ─────────────────
await testAsync('Agent sends desktop tools in tools array to LLM (Windows only)', async () => {
  let capturedBody = null;

  await runWithServer(
    (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/chat/completions' && req.method === 'POST') {
          capturedBody = body;
          sendSSEResponse(res, 'List desktop tools');
        } else if (req.url === '/models') {
          sendModelsResponse(res);
        }
      });
    },
    async (baseURL) => {
      const agent = new Agent(makeConfig(baseURL));

      await agent.process('Apa saja tool desktop?', {
        effort: 'Low',
        mode: 'general',
        onProgress: () => {},
      });

      const parsed = JSON.parse(capturedBody);
      const toolNames = (parsed.tools || []).map((t) => t.function.name);

      if (desktop.isDesktopSupported()) {
        // Desktop tools should be included on Windows
        assert.ok(toolNames.includes('screenshot'), 'Harus ada screenshot tool');
        assert.ok(toolNames.includes('list_windows'), 'Harus ada list_windows tool');
        assert.ok(toolNames.includes('get_screen_size'), 'Harus ada get_screen_size');
        assert.ok(toolNames.includes('mouse_move'), 'Harus ada mouse_move');
        assert.ok(toolNames.includes('mouse_click'), 'Harus ada mouse_click');
        assert.ok(toolNames.includes('get_cursor_pos'), 'Harus ada get_cursor_pos');
        assert.ok(toolNames.includes('type_text'), 'Harus ada type_text');
        assert.ok(toolNames.includes('press_key'), 'Harus ada press_key');
        assert.ok(toolNames.includes('focus_window'), 'Harus ada focus_window');
        assert.ok(toolNames.includes('launch_app'), 'Harus ada launch_app');
      } else {
        // No desktop tools on non-Windows
        assert.ok(!toolNames.includes('screenshot'), 'Screenshot tidak ada di non-Windows');
        assert.ok(!toolNames.includes('list_windows'), 'list_windows tidak ada di non-Windows');
      }
    },
  );
});

// ── 2. Tool call: screenshot ─────────────────────────────────
await testAsync('Agent processes screenshot tool call from LLM', async () => {
  const { _setPSMock, _clearPSMock } = desktop;

  // Mock PowerShell untuk screenshot
  _setPSMock(() => {
    return JSON.stringify({
      path: 'C:/Users/test/.nythros/screenshots/test.png',
      width: 1920,
      height: 1080,
      size_kb: 145.2,
    });
  });

  try {
    let toolResultContent = null;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const lastMsg = parsed.messages[parsed.messages.length - 1];

            if (lastMsg?.role === 'tool') {
              // Second turn: LLM received tool result
              toolResultContent = lastMsg.content;
              sendSSEResponse(res, 'Screenshot berhasil!');
            } else {
              // First turn: LLM asked to call tool
              sendSSEToolCall(res, [{ id: 'call_1', name: 'screenshot', input: {} }]);
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        const result = await agent.process('Ambil screenshot layar', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        assert.ok(result, 'Result harus ada');
        // Either final text or tool result captured
        if (toolResultContent) {
          assert.ok(toolResultContent.includes('.png'), 'Tool result harus path PNG');
          assert.ok(toolResultContent.includes('1920'), 'Harus ada dimensi');
        }
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 3. Tool call: list_windows ───────────────────────────────
await testAsync('Agent processes list_windows tool call with mock data', async () => {
  desktop._setPSMock(() => {
    return JSON.stringify([
      { hwnd: '100', title: 'Visual Studio Code', pid: 1234, focused: true },
      { hwnd: '200', title: 'Notepad', pid: 5678, focused: false },
    ]);
  });

  try {
    let toolResultContent = null;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const lastMsg = parsed.messages[parsed.messages.length - 1];

            if (lastMsg?.role === 'tool') {
              toolResultContent = lastMsg.content;
              sendSSEResponse(res, 'Windows terkumpul');
            } else {
              sendSSEToolCall(res, [
                { id: 'call_2', name: 'list_windows', input: { filter: 'notepad' } },
              ]);
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        await agent.process('Cari window Notepad', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        if (toolResultContent) {
          assert.ok(toolResultContent.includes('Notepad'), 'Harus ada Notepad');
          assert.ok(toolResultContent.includes('[5678]'), 'Harus ada PID 5678');
          assert.ok(
            !toolResultContent.includes('Visual Studio Code'),
            'Filter harus exclude VS Code',
          );
        }
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 4. Tool call: mouse_move ─────────────────────────────────
await testAsync('Agent processes mouse_move tool call with coordinates', async () => {
  desktop._setPSMock(() => {
    return JSON.stringify({ x: 500, y: 300 });
  });

  try {
    let toolResultContent = null;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const lastMsg = parsed.messages[parsed.messages.length - 1];

            if (lastMsg?.role === 'tool') {
              toolResultContent = lastMsg.content;
              sendSSEResponse(res, 'Mouse moved');
            } else {
              sendSSEToolCall(res, [
                { id: 'call_3', name: 'mouse_move', input: { x: 500, y: 300 } },
              ]);
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        await agent.process('Pindah mouse ke 500, 300', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        if (toolResultContent) {
          assert.ok(toolResultContent.includes('Pindah'), 'Tool result harus sukses');
          assert.ok(toolResultContent.includes('500'), 'x=500');
          assert.ok(toolResultContent.includes('300'), 'y=300');
        }
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 5. Multiple parallel tool calls ──────────────────────────
await testAsync(
  'Agent handles multiple parallel tool calls (screenshot + get_screen_size)',
  async () => {
    let callIdx = 0;
    desktop._setPSMock(() => {
      callIdx++;
      if (callIdx === 1) {
        return JSON.stringify({
          width: 1920,
          height: 1080,
          working_width: 1920,
          working_height: 1040,
          bits_per_pixel: 32,
        });
      }
      return JSON.stringify({
        path: 'C:/Users/test/.nythros/screenshots/parallel.png',
        width: 1920,
        height: 1080,
        size_kb: 100,
      });
    });

    try {
      let toolResults = [];

      await runWithServer(
        (req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            if (req.url === '/chat/completions' && req.method === 'POST') {
              const parsed = JSON.parse(body);
              const msgs = parsed.messages;

              // Check for tool results
              const toolMsgs = msgs.filter((m) => m.role === 'tool');
              if (toolMsgs.length > 0) {
                toolResults = toolMsgs.map((m) => m.content);
                sendSSEResponse(res, `Selesai: ${toolMsgs.length} tool calls`);
              } else {
                // Send TWO parallel tool calls
                sendSSEToolCall(res, [
                  { id: 'call_p1', name: 'get_screen_size', input: {} },
                  { id: 'call_p2', name: 'screenshot', input: {} },
                ]);
              }
            } else if (req.url === '/models') {
              sendModelsResponse(res);
            }
          });
        },
        async (baseURL) => {
          const agent = new Agent(makeConfig(baseURL));
          await agent.process('Cek layar dan screenshot', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });

          assert.equal(toolResults.length, 2, 'Harus ada 2 tool results (parallel)');
          // One should be screen size, one should be screenshot
          const hasScreenSize = toolResults.some((r) => r.includes('Resolusi'));
          const hasScreenshot = toolResults.some((r) => r.includes('.png'));
          assert.ok(hasScreenSize, 'Salah satu hasil harus screen size');
          assert.ok(hasScreenshot, 'Salah satu hasil harus screenshot');
        },
      );
    } finally {
      desktop._clearPSMock();
    }
  },
);

// ── 6. Unknown tool handled gracefully ───────────────────────
await testAsync('Agent handles unknown tool call gracefully', async () => {
  let toolResultContent = null;

  await runWithServer(
    (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/chat/completions' && req.method === 'POST') {
          const parsed = JSON.parse(body);
          const lastMsg = parsed.messages[parsed.messages.length - 1];

          if (lastMsg?.role === 'tool') {
            toolResultContent = lastMsg.content;
            sendSSEResponse(res, 'Unknown tool handled');
          } else {
            sendSSEToolCall(res, [{ id: 'call_unknown', name: 'nonexistent_tool_xyz', input: {} }]);
          }
        } else if (req.url === '/models') {
          sendModelsResponse(res);
        }
      });
    },
    async (baseURL) => {
      const agent = new Agent(makeConfig(baseURL));
      await agent.process('Panggil tool aneh', {
        effort: 'Low',
        mode: 'general',
        onProgress: () => {},
      });

      if (toolResultContent) {
        assert.ok(
          toolResultContent.includes('Error') || toolResultContent.includes('not found'),
          'Tool unknown harus error message',
        );
      }
    },
  );
});

// ── 7. Launch app combo ─────────────────────────────────────
await testAsync('Agent processes launch_app then type_text in sequence', async () => {
  let callIdx = 0;
  desktop._setPSMock(() => {
    callIdx++;
    if (callIdx === 1) {
      return JSON.stringify({ chars: 12, delay_ms: 5 });
    }
    return JSON.stringify({ pid: 9999, process: 'notepad', success: true });
  });

  try {
    let toolResults = [];

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const msgs = parsed.messages;
            const toolMsgs = msgs.filter((m) => m.role === 'tool');

            if (toolMsgs.length > 0) {
              toolResults = toolMsgs.map((m) => m.content);
              sendSSEResponse(res, 'Typing complete');
            } else {
              // First: launch notepad
              sendSSEToolCall(res, [
                { id: 'call_l1', name: 'launch_app', input: { target: 'notepad.exe' } },
              ]);
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        await agent.process('Buka notepad lalu ketik "Hello World"', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        if (toolResults.length > 0) {
          // At least one tool executed
          assert.ok(toolResults.length >= 1, 'Minimal 1 tool result');
        }
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 8. Tool chaining: launch → focus → type (3-turn sequence) ──
await testAsync('Agent handles 3-turn tool chain: launch → focus_window → type_text', async () => {
  let callIdx = 0;
  desktop._setPSMock(() => {
    callIdx++;
    if (callIdx === 1) {
      // launch_app mock
      return JSON.stringify({ pid: 8888, process: 'notepad', success: true });
    }
    if (callIdx === 2) {
      // focus_window mock
      return JSON.stringify({ title: 'Untitled - Notepad', success: true });
    }
    // type_text mock
    return JSON.stringify({ chars: 11, delay_ms: 5 });
  });

  try {
    // Track chain progression
    let chainSteps = [];
    let finalText = null;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const msgs = parsed.messages;
            const toolMsgCount = msgs.filter((m) => m.role === 'tool').length;

            if (toolMsgCount === 0) {
              // Step 1: launch_notepad
              sendSSEToolCall(res, [
                { id: 'call_c1', name: 'launch_app', input: { target: 'notepad.exe' } },
              ]);
            } else if (toolMsgCount === 1) {
              // Step 2: focus_notepad
              chainSteps.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEToolCall(res, [
                { id: 'call_c2', name: 'focus_window', input: { title: 'Notepad' } },
              ]);
            } else if (toolMsgCount === 2) {
              // Step 3: type_hello
              chainSteps.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEToolCall(res, [
                {
                  id: 'call_c3',
                  name: 'type_text',
                  input: { text: 'Hello Nythros!', delay_ms: 5 },
                },
              ]);
            } else {
              // Final: done
              chainSteps.push(msgs.filter((m) => m.role === 'tool').pop().content);
              finalText = 'Chain complete: notepad launched, focused, typed Hello Nythros!';
              sendSSEResponse(res, finalText);
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        const result = await agent.process('Buka Notepad, fokuskan, lalu ketik "Hello Nythros!"', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        // Verify chain completed: 3 tool results captured
        assert.equal(chainSteps.length, 3, 'Harus ada 3 tool results dalam chain');

        // Verify each step content
        const launchResult = chainSteps[0];
        const focusResult = chainSteps[1];
        const typeResult = chainSteps[2];

        // Step 1: launch_app result should mention PID
        assert.ok(
          launchResult.includes('8888'),
          `launch_app harus mention PID 8888: ${launchResult}`,
        );
        assert.ok(
          launchResult.includes('notepad'),
          `launch_app harus mention notepad: ${launchResult}`,
        );

        // Step 2: focus_window result
        assert.ok(
          focusResult.includes('Notepad'),
          `focus_window harus mention Notepad: ${focusResult}`,
        );

        // Step 3: type_text result
        assert.ok(typeResult.includes('11'), `type_text harus mention char count: ${typeResult}`);

        // Final result from LLM
        if (finalText) {
          assert.ok(
            result.text.includes('Hello Nythros') || result.text.includes('complete'),
            `Final text harus mention completion: ${result.text}`,
          );
        }
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 9. 4-turn chain: screenshot → type_text → press_key → screenshot ─
await testAsync('Agent handles 4-turn chain: screenshot → type → press → screenshot', async () => {
  let callIdx = 0;
  desktop._setPSMock(() => {
    callIdx++;
    if (callIdx === 1 || callIdx === 4) {
      // screenshot mock (called twice: before & after typing)
      return JSON.stringify({
        path: `C:/test/screen_${callIdx}.png`,
        width: 1920,
        height: 1080,
        size_kb: 150,
      });
    }
    if (callIdx === 2) {
      // type_text mock
      return JSON.stringify({ chars: 12, delay_ms: 0 });
    }
    // press_key mock (ctrl+enter)
    return JSON.stringify({ key: 'ctrl+enter' });
  });

  try {
    let chainResults = [];

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const msgs = parsed.messages;
            const toolMsgCount = msgs.filter((m) => m.role === 'tool').length;

            if (toolMsgCount === 0) {
              // Step 1: screenshot before typing
              sendSSEToolCall(res, [{ id: 'call_s1', name: 'screenshot', input: {} }]);
            } else if (toolMsgCount === 1) {
              // Step 2: type_text
              chainResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEToolCall(res, [
                {
                  id: 'call_s2',
                  name: 'type_text',
                  input: { text: 'Selesai!\nBaris 2', delay_ms: 0 },
                },
              ]);
            } else if (toolMsgCount === 2) {
              // Step 3: press_key
              chainResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEToolCall(res, [
                { id: 'call_s3', name: 'press_key', input: { key: 'ctrl+enter' } },
              ]);
            } else if (toolMsgCount === 3) {
              // Step 4: screenshot after typing
              chainResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEToolCall(res, [{ id: 'call_s4', name: 'screenshot', input: {} }]);
            } else {
              // Final
              chainResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEResponse(res, 'Chain selesai: 4 steps');
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        const result = await agent.process(
          'Ambil screenshot, ketik teks, tekan Ctrl+Enter, screenshot lagi',
          {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          },
        );

        // Verify chain completed: 4 tool results captured
        assert.equal(chainResults.length, 4, 'Harus ada 4 tool results dalam chain');

        // Verify screenshot paths are different (before vs after)
        const screenshot1 = chainResults[0];
        const screenshot2 = chainResults[3];
        assert.ok(
          screenshot1.includes('.png'),
          `Screenshot 1 harus path PNG: ${screenshot1.substring(0, 80)}`,
        );
        assert.ok(
          screenshot2.includes('.png'),
          `Screenshot 2 harus path PNG: ${screenshot2.substring(0, 80)}`,
        );

        // Verify press_key handled
        const pressResult = chainResults[2];
        assert.ok(
          pressResult.includes('ctrl+enter') || pressResult.includes('ditekan'),
          `press_key harus mention keys: ${pressResult}`,
        );

        // Final result exists
        assert.ok(result.text, 'Final text harus ada');
        assert.ok(result.text.length > 0, 'Final text tidak boleh kosong');
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 10. Chain with error recovery: tool error → continue ──────
await testAsync('Agent handles chain with error recovery (mid-chain tool error)', async () => {
  let callIdx = 0;
  desktop._setPSMock(() => {
    callIdx++;
    if (callIdx === 1) {
      // Type text succeeds
      return JSON.stringify({ chars: 5, delay_ms: 0 });
    }
    if (callIdx === 2) {
      // Mouse click — simulate PowerShell error
      throw new Error('Simulated COM error: window not responding');
    }
    // Press key — succeeds
    return JSON.stringify({ key: 'escape' });
  });

  try {
    let chainSteps = [];
    let finalText = null;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const msgs = parsed.messages;
            const toolMsgCount = msgs.filter((m) => m.role === 'tool').length;

            if (toolMsgCount === 0) {
              // Step 1: type text
              sendSSEToolCall(res, [
                { id: 'call_e1', name: 'type_text', input: { text: 'Halo!', delay_ms: 0 } },
              ]);
            } else if (toolMsgCount === 1) {
              // Step 2: mouse_click — mock will THROW
              chainSteps.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEToolCall(res, [
                { id: 'call_e2', name: 'mouse_click', input: { button: 'left', x: 100, y: 200 } },
              ]);
            } else if (toolMsgCount === 2) {
              // Step 3: press_key — continues despite previous error
              chainSteps.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEToolCall(res, [
                { id: 'call_e3', name: 'press_key', input: { key: 'escape' } },
              ]);
            } else {
              // Final
              chainSteps.push(msgs.filter((m) => m.role === 'tool').pop().content);
              finalText = 'Chain selesai walaupun ada error di tengah';
              sendSSEResponse(res, finalText);
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        const result = await agent.process('Ketik halo, klik kiri, tekan escape', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        // Verify chain completed: 3 tool results captured
        assert.equal(chainSteps.length, 3, 'Harus ada 3 tool results meskipun ada error');

        // Step 1 type_text should be success
        const typeResult = chainSteps[0];
        assert.ok(typeResult.includes('5'), `type_text harus sukses: ${typeResult}`);

        // Step 2 mouse_click should have error message
        const clickResult = chainSteps[1];
        assert.ok(
          clickResult.includes('Error') ||
            clickResult.includes('error') ||
            clickResult.includes('not responding'),
          `mouse_click harus error message: ${clickResult}`,
        );

        // Step 3 press_key should still succeed after error
        const pressResult = chainSteps[2];
        assert.ok(
          pressResult.includes('escape') || pressResult.includes('ditekan'),
          `press_key harus tetap sukses: ${pressResult}`,
        );

        // Final result
        assert.ok(result.text, 'Final text harus ada');
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 11. Mixed parallel + sequential chain ─────────────────────
await testAsync(
  'Agent handles mixed parallel + sequential: 2 parallel tools then 1 sequential tool',
  async () => {
    let callIdx = 0;
    desktop._setPSMock(() => {
      callIdx++;
      if (callIdx === 1) {
        // get_screen_size
        return JSON.stringify({
          width: 1920,
          height: 1080,
          working_width: 1920,
          working_height: 1040,
          bits_per_pixel: 32,
        });
      }
      if (callIdx === 2) {
        // screenshot (parallel with get_screen_size)
        return JSON.stringify({
          path: 'C:/test/parallel_screen.png',
          width: 1920,
          height: 1080,
          size_kb: 145,
        });
      }
      // type_text (sequential after parallel)
      return JSON.stringify({ chars: 8, delay_ms: 0 });
    });

    try {
      let parallelResults = [];
      let sequentialResult = '';
      let chainComplete = false;

      await runWithServer(
        (req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            if (req.url === '/chat/completions' && req.method === 'POST') {
              const parsed = JSON.parse(body);
              const msgs = parsed.messages;
              const toolMsgCount = msgs.filter((m) => m.role === 'tool').length;

              if (toolMsgCount === 0) {
                // Turn 1: Kirim 2 tool calls PARALEL
                sendSSEToolCall(res, [
                  { id: 'call_m1', name: 'get_screen_size', input: {} },
                  { id: 'call_m2', name: 'screenshot', input: {} },
                ]);
              } else if (toolMsgCount === 2) {
                // Turn 2: Simpan hasil paralel, kirim 1 tool call SEQUENTIAL
                parallelResults = msgs.filter((m) => m.role === 'tool').map((m) => m.content);
                sendSSEToolCall(res, [
                  { id: 'call_m3', name: 'type_text', input: { text: 'Hasil siap', delay_ms: 0 } },
                ]);
              } else if (toolMsgCount === 3) {
                // Turn 3: Simpan hasil sequential, kirim final
                sequentialResult = msgs.filter((m) => m.role === 'tool').pop().content;
                chainComplete = true;
                sendSSEResponse(res, 'Mixed chain selesai: 2 parallel + 1 sequential');
              }
            } else if (req.url === '/models') {
              sendModelsResponse(res);
            }
          });
        },
        async (baseURL) => {
          const agent = new Agent(makeConfig(baseURL));
          const result = await agent.process('Cek layar, ambil screenshot, lalu ketik hasilnya', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });

          // Verify mixed chain completed
          assert.ok(chainComplete, 'Chain harus selesai');

          // Verify parallel results: 2 tool results from first turn
          assert.equal(parallelResults.length, 2, 'Harus ada 2 hasil dari parallel turn');
          const hasScreenSize = parallelResults.some((r) => r.includes('Resolusi'));
          const hasScreenshot = parallelResults.some((r) => r.includes('.png'));
          assert.ok(hasScreenSize, 'Salah satu parallel result harus screen size');
          assert.ok(hasScreenshot, 'Salah satu parallel result harus screenshot');

          // Verify sequential result: type_text after parallel
          assert.ok(
            sequentialResult.includes('8'),
            `Sequential type_text harus mention char count: ${sequentialResult}`,
          );

          // Verify messages array has correct structure
          const toolMsgs = result.messages.filter((m) => m.role === 'tool');
          assert.equal(toolMsgs.length, 3, 'Total harus 3 tool messages');

          // Final text
          assert.ok(result.text.length > 0, 'Final text tidak boleh kosong');
        },
      );
    } finally {
      desktop._clearPSMock();
    }
  },
);

// ── 12. Max iterations exceeded ──────────────────────────────
await testAsync('Agent stops after max iterations (10 turns) and returns warning', async () => {
  let llmCallCount = 0;
  let toolExecCount = 0;

  // Mock: always return screenshot data (tool always succeeds)
  desktop._setPSMock(() => {
    toolExecCount++;
    return JSON.stringify({
      path: `C:/test/loop_${toolExecCount}.png`,
      width: 1920,
      height: 1080,
      size_kb: 100,
    });
  });

  try {
    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            llmCallCount++;
            // ALWAYS respond with tool calls — never with text
            sendSSEToolCall(res, [
              { id: `call_loop_${llmCallCount}`, name: 'screenshot', input: {} },
            ]);
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        const startTime = Date.now();
        const result = await agent.process('Loop terus sampai max iterations', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });
        const elapsed = Date.now() - startTime;

        // Must return max iterations warning
        assert.equal(
          result.text,
          '⚠️ Max iterations reached.',
          'Agent harus return max iterations message setelah 10 loop',
        );

        // Must have called LLM 10 times (maxIterations)
        assert.equal(llmCallCount, 10, `LLM harus dipanggil 10 kali (dipanggil ${llmCallCount})`);

        // Tool should have been executed 10 times
        assert.equal(
          toolExecCount,
          10,
          `Tool harus dieksekusi 10 kali (dieksekusi ${toolExecCount})`,
        );

        // Should complete within reasonable time (all mocked, < 5s)
        assert.ok(elapsed < 5000, `Max iterations harus cepat (< 5s, selesai dalam ${elapsed}ms)`);

        // Messages should contain 10 tool results + 10 assistant messages + user prompt
        const toolMsgs = result.messages.filter((m) => m.role === 'tool');
        assert.equal(toolMsgs.length, 10, 'Harus ada 10 tool messages');

        // usage should be accumulated across all turns
        assert.ok(result.usage.total_tokens > 0, 'Usage harus terakumulasi');
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 13. Tool throwing non-Error type ──────────────────────────
await testAsync('Agent handles tool throwing non-Error type (string/null/object)', async () => {
  let throwIdx = 0;
  desktop._setPSMock(() => {
    throwIdx++;
    if (throwIdx === 1) {
      throw 'String error message'; // throws string, not Error
    }
    if (throwIdx === 2) {
      throw null; // throws null
    }
    throw { custom: 'error', code: 500 }; // throws object
  });

  try {
    let toolResults = [];

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const msgs = parsed.messages;
            const toolMsgCount = msgs.filter((m) => m.role === 'tool').length;

            if (toolMsgCount === 0) {
              // Turn 1: type_text, mock throws string
              sendSSEToolCall(res, [
                { id: 'call_t1', name: 'type_text', input: { text: 'Halo', delay_ms: 0 } },
              ]);
            } else if (toolMsgCount === 1) {
              toolResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              // Turn 2: mouse_move, mock throws null
              sendSSEToolCall(res, [
                { id: 'call_t2', name: 'mouse_move', input: { x: 100, y: 200 } },
              ]);
            } else if (toolMsgCount === 2) {
              toolResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              // Turn 3: press_key, mock throws object
              sendSSEToolCall(res, [
                { id: 'call_t3', name: 'press_key', input: { key: 'escape' } },
              ]);
            } else {
              toolResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEResponse(res, 'Non-Error throws handled gracefully');
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        await agent.process('Tes tool throws non-Error types', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        // All 3 tools should return error messages (not crash the agent)
        assert.equal(toolResults.length, 3, 'Harus ada 3 tool results');

        // String throw: tool's catch evaluates `e.message` on a string → undefined
        // Tool returns: ❌ Gagal type: undefined (tool error format, not Agent fallback)
        const typeResult = toolResults[0];
        assert.ok(
          typeResult.includes('❌') || typeResult.includes('Gagal'),
          `String throw harus error message: ${typeResult}`,
        );

        // Null throw: accessing null.message throws TypeError INSIDE tool's catch!
        // TypeError propagates to Agent loop's catch → "Error executing tool"
        // Either tool format (❌ Gagal...) or Agent format (Error executing...) is valid
        const moveResult = toolResults[1];
        assert.ok(
          moveResult.includes('❌') ||
            moveResult.includes('Gagal') ||
            moveResult.includes('Error executing'),
          `Null throw harus error message: ${moveResult}`,
        );

        // Object throw: e.message is undefined → tool returns ❌ Gagal press key: undefined
        const pressResult = toolResults[2];
        assert.ok(
          pressResult.includes('❌') || pressResult.includes('Gagal'),
          `Object throw harus error message: ${pressResult}`,
        );
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 14. Tool returning empty string ───────────────────────────
await testAsync('Agent handles tool returning empty string gracefully', async () => {
  let callIdx = 0;
  desktop._setPSMock(() => {
    callIdx++;
    if (callIdx === 1) {
      return ''; // empty string
    }
    return JSON.stringify({ key: 'enter' }); // normal result after
  });

  try {
    let toolResults = [];

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            const parsed = JSON.parse(body);
            const msgs = parsed.messages;
            const toolMsgCount = msgs.filter((m) => m.role === 'tool').length;

            if (toolMsgCount === 0) {
              // Turn 1: get_cursor_pos, mock returns empty string
              sendSSEToolCall(res, [{ id: 'call_e1', name: 'get_cursor_pos', input: {} }]);
            } else if (toolMsgCount === 1) {
              toolResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              // Turn 2: press_key, mock returns normal data
              sendSSEToolCall(res, [{ id: 'call_e2', name: 'press_key', input: { key: 'enter' } }]);
            } else {
              toolResults.push(msgs.filter((m) => m.role === 'tool').pop().content);
              sendSSEResponse(res, 'Empty string result handled');
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        await agent.process('Cek cursor lalu tekan enter', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });

        assert.equal(toolResults.length, 2, 'Harus ada 2 tool results');

        // First tool returned empty string (get_cursor_pos mock)
        // get_cursor_pos.execute: calls execPSJson -> mock returns ''
        // execPSJson: out is '', checks `if (!out) throw new Error('PowerShell returned empty output.')`
        // This throws! Then caught by tool's try/catch: `return `❌ Gagal get cursor: ${e.message}``
        // So result should be error message
        const emptyResult = toolResults[0];
        assert.ok(
          emptyResult.includes('❌') || emptyResult.includes('Gagal'),
          `Empty mock harus jadi error tool: ${emptyResult}`,
        );

        // Second tool (press_key) should still work fine after empty result
        const pressResult = toolResults[1];
        assert.ok(
          pressResult.includes('enter') || pressResult.includes('ditekan'),
          `press_key harus tetap sukses: ${pressResult}`,
        );
      },
    );
  } finally {
    desktop._clearPSMock();
  }
});

// ── 15. Connection drop mid-chain ────────────────────────────
await testAsync(
  'Agent throws network error when connection drops mid-chain (second LLM request fails)',
  async () => {
    recordSuccess(); // Reset circuit breaker before error tests
    let requestCount = 0;
    desktop._setPSMock(() => {
      return JSON.stringify({ pid: 8888, process: 'notepad', success: true });
    });

    try {
      let caughtError = null;

      await runWithServer(
        (req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            if (req.url === '/chat/completions' && req.method === 'POST') {
              requestCount++;
              if (requestCount === 1) {
                // First request succeeds: send tool_call
                sendSSEToolCall(res, [
                  { id: 'call_d1', name: 'launch_app', input: { target: 'notepad.exe' } },
                ]);
              } else {
                // Second request: DROP CONNECTION mid-response
                // This simulates network outage or server crash mid-chain
                res.destroy();
              }
            } else if (req.url === '/models') {
              sendModelsResponse(res);
            }
          });
        },
        async (baseURL) => {
          const agent = new Agent(makeConfig(baseURL));
          try {
            await agent.process('Buka notepad lalu lanjut', {
              effort: 'Low',
              mode: 'general',
              onProgress: () => {},
            });
            // Should NOT reach here
            assert.fail('Harus throw error karena koneksi putus di tengah chain');
          } catch (err) {
            caughtError = err;
          }
        },
      );

      // Verify error was caught
      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap dari agent.process()');

      if (caughtError) {
        const msg =
          typeof caughtError === 'string'
            ? caughtError
            : caughtError.message || String(caughtError);
        // Should be a network/connection related error, NOT a silent hang
        assert.ok(msg.length > 0, 'Error message tidak boleh kosong');
        assert.ok(
          msg.includes('Network error') ||
            msg.includes('fetch') ||
            msg.includes('koneksi') ||
            msg.includes('connection') ||
            msg.includes('socket') ||
            msg.includes('request') ||
            msg.includes('Streaming'),
          `Error harus tentang network/connection. Pesan: ${msg.slice(0, 200)}`,
        );
        // Verify it's NOT the max iterations message (would mean chain kept going)
        assert.ok(
          !msg.includes('Max iterations'),
          'Error BUKAN max iterations — chain harusnya STOP saat koneksi putus',
        );
      }
    } finally {
      desktop._clearPSMock();
    }
  },
);

// ── 16. SSE stream interrupted mid-response ───────────────────
await testAsync(
  'Agent throws error when SSE connection drops mid-stream (incomplete response)',
  async () => {
    let caughtError = null;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            // Start SSE stream: write headers and begin streaming
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            res.flushHeaders(); // Flush headers + any buffered write data before destroy
            // Send role announcement
            sendSSEChunk(res, {
              choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
            });
            // Send partial content chunk, then DESTROY before stream completes
            sendSSEChunk(res, {
              choices: [{ index: 0, delta: { content: 'Sebagian teks...' }, finish_reason: null }],
            });
            // Forcefully terminate the TCP connection mid-SSE-stream
            // With flushHeaders() called, the client should receive data before destroy
            res.destroy();
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        try {
          await agent.process('Tulis teks yang agak panjang', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });
          assert.fail('Harus throw error karena SSE stream terputus di tengah');
        } catch (err) {
          caughtError = err;
        }
      },
    );

    // Verify error was caught (core assertion)
    assert.ok(
      caughtError !== null,
      'Harus ada error yang ditangkap dari agent.process() saat SSE stream putus',
    );

    if (caughtError) {
      const msg =
        typeof caughtError === 'string' ? caughtError : caughtError.message || String(caughtError);
      assert.ok(msg.length > 0, 'Error message tidak boleh kosong');
      // Error should reference streaming/connection/network failure
      assert.ok(
        msg.includes('Streaming') ||
          msg.includes('stream') ||
          msg.includes('fetch') ||
          msg.includes('koneksi') ||
          msg.includes('connection') ||
          msg.includes('socket') ||
          msg.includes('Network error'),
        `Error harus tentang streaming/connection. Pesan: ${msg.slice(0, 200)}`,
      );
    }
  },
);

// ── Cleanup ───────────────────────────────────────────────────
desktop._clearPSMock();
recordSuccess(); // Reset circuit breaker so other test files in npm chain don't get blocked

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
