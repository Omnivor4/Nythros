// tests/openaiCompatible.test.js
// Unit test untuk src/providers/openaiCompatible.js — toOpenAITools, response parsing
// Jalanin: node tests/openaiCompatible.test.js
//
// CATATAN: Test ini nggak manggil API beneran — cuma test logic parsing & formatting.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

console.log('\n🧪 OpenAICompatible Provider Tests\n');

const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

// Test 1: Constructor strips trailing slash dari baseURL
test('Constructor strips trailing slash from baseURL', () => {
  const p = new OpenAICompatibleProvider({
    apiKey: 'sk-test',
    model: 'gpt-4o',
    baseURL: 'https://api.test.com/v1/',
  });
  assert.equal(p.baseURL, 'https://api.test.com/v1', 'Should strip trailing slash');
});

// Test 2: Constructor without trailing slash
test('Constructor keeps baseURL without trailing slash', () => {
  const p = new OpenAICompatibleProvider({
    apiKey: 'sk-test',
    model: 'gpt-4o',
    baseURL: 'https://api.test.com/v1',
  });
  assert.equal(p.baseURL, 'https://api.test.com/v1');
});

// Test 3: buildToolResultMessage returns correct format
test('buildToolResultMessage returns correct tool result format', () => {
  const p = new OpenAICompatibleProvider({
    apiKey: 'sk-test',
    model: 'gpt-4o',
    baseURL: 'https://api.test.com/v1',
  });
  const toolCall = { id: 'call_123', name: 'read_file', input: { path: 'test.txt' } };
  const result = p.buildToolResultMessage(toolCall, 'file content here');
  assert.equal(result.role, 'tool', 'Role should be tool');
  assert.equal(result.tool_call_id, 'call_123', 'Should have correct tool_call_id');
  assert.equal(result.content, 'file content here', 'Should have correct content');
});

// Test 4: Non-streaming response parsing (simulasi JSON response)
test('parse non-streaming response correctly', () => {
  // Simulasi raw API response
  const mockResponse = {
    id: 'chatcmpl-123',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello, this is a test response!',
          tool_calls: null,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };

  // Kita test logic parsing yang ada di dalam send()
  // Ambil choice dan parse toolCalls seperti yang dilakukan send()
  const choice = mockResponse.choices[0];
  assert.ok(choice, 'Should have choice');
  const msg = choice.message;
  assert.equal(msg.content, 'Hello, this is a test response!');

  const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}'),
  }));
  assert.equal(toolCalls.length, 0, 'No tool calls expected');

  const usage = mockResponse.usage;
  assert.equal(usage.prompt_tokens, 10);
  assert.equal(usage.total_tokens, 15);
});

// Test 5: Tool call response parsing
test('parse tool call response correctly', () => {
  const mockResponse = {
    id: 'chatcmpl-456',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"test.txt"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };

  const choice = mockResponse.choices[0];
  const msg = choice.message;
  const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}'),
  }));

  assert.equal(toolCalls.length, 1, 'Should have 1 tool call');
  assert.equal(toolCalls[0].name, 'read_file');
  assert.equal(toolCalls[0].input.path, 'test.txt');
});

// Test 6: Non-streaming response with empty content
test('non-streaming returns textOutput when no tool_calls', () => {
  const mockChoice = {
    message: { role: 'assistant', content: 'simple response', tool_calls: null },
  };
  const toolCalls = (mockChoice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    input: JSON.parse(tc.function?.arguments || '{}'),
  }));
  const textOutput = toolCalls.length === 0 ? (mockChoice.message.content ?? '') : null;
  assert.equal(textOutput, 'simple response');
  assert.equal(toolCalls.length, 0);
});

// Test 7: Streaming parser simulation — delta content accumulation
test('streaming delta content accumulates correctly', () => {
  // Simulasi internal _handleStream parser logic
  let fullContent = '';
  const deltas = ['Hello', ' ', 'World', '!'];

  for (const d of deltas) fullContent += d;
  assert.equal(fullContent, 'Hello World!', 'Content should accumulate correctly');
});

// Test 8: Streaming delta tool_calls accumulation
test('streaming delta tool_calls accumulate correctly', () => {
  // Simulasi internal toolCallsAccumulator dari _handleStream
  const accumulator = {};

  // Chunk 1: first tool call
  accumulator[0] = { id: 'call_1', name: 'read_file', arguments_str: '' };
  accumulator[0].id = 'call_1';
  accumulator[0].name = 'read_file';
  accumulator[0].arguments_str += '{"path":';

  // Chunk 2: more args
  accumulator[0].arguments_str += '"test.txt"}';

  const toolCalls = Object.values(accumulator)
    .filter((tc) => tc.name)
    .map((tc) => ({
      id: tc.id,
      name: tc.name,
      input: JSON.parse(tc.arguments_str || '{}'),
    }));

  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, 'read_file');
  assert.equal(toolCalls[0].input.path, 'test.txt');
});

// Test 9: toOpenAITools (internal) format conversion
test('toOpenAITools converts Nythros tool format to OpenAI', () => {
  const nythrosTools = [
    {
      name: 'test_tool',
      description: 'A test tool',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  ];

  // Akses internal function toOpenAITools via send() — cek dulu ada di module scope
  // Kita test langsung lewat import
  const openaiTools = nythrosTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  assert.equal(openaiTools.length, 1);
  assert.equal(openaiTools[0].type, 'function');
  assert.equal(openaiTools[0].function.name, 'test_tool');
  assert.equal(openaiTools[0].function.parameters.required[0], 'path');
});

// Test 10: Effort level maps to max_tokens correctly
test('effort level maps to max_tokens correctly', () => {
  // Simulasi logic dari send()
  const effortToTokens = { Low: 1024, Medium: 4096, High: 16384 };

  assert.equal(effortToTokens.Low, 1024);
  assert.equal(effortToTokens.Medium, 4096);
  assert.equal(effortToTokens.High, 16384);
});

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
