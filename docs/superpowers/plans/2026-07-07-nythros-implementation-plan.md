# Nythros v0.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Nythros into an intelligent agent with thinking trace, OS automation, and optimized context management.

**Architecture:** Refactor `src/agent/loop.js` to enforce thinking trace, implement auto-install MCP system, and prune context per turn.

**Tech Stack:** Node.js (native ESM), MCP Client, standard async patterns.

## Global Constraints
- Use native Node.js built-ins where possible (no new external dependencies unless strictly necessary).
- Maintain Bahasa Indonesia for user-facing output.
- Follow existing file structure and design patterns.

---

### Task 1: Thought Trace & Thinking Gate

**Files:**
- Modify: `src/agent/systemPrompt.js`
- Modify: `src/agent/loop.js`

**Interfaces:**
- Produces: `thought` trace in agent response stream.

- [ ] **Step 1: Update system prompt**

Add to `src/agent/systemPrompt.js`:
```javascript
// Add to system prompt builder
const thinkingInstruction = `
<THINKING_INSTRUCTION>
Sebelum beraksi, KAMU WAJIB:
1. Nilai ambiguitas prompt. Jika tidak jelas, tanya balik.
2. Berpikir langkah-demi-langkah.
3. Output pemikiran di dalam tag <thought>.
</THINKING_INSTRUCTION>
`;
```

- [ ] **Step 2: Update loop parser**

Modify `src/agent/loop.js` to extract `<thought>` content and print it to UI before tool execution.

- [ ] **Step 3: Commit**

```bash
git add src/agent/systemPrompt.js src/agent/loop.js
git commit -m "feat: add thinking trace to agent loop"
```

---

### Task 2: Auto-MCP Presets & OS Automation

**Files:**
- Create: `src/infrastructure/mcp/presets.js`
- Modify: `src/presentation/repl.js`

**Interfaces:**
- Produces: `os-control` and `sequential-thinking` MCP server capability.

- [ ] **Step 1: Create presets**

Create `src/infrastructure/mcp/presets.js`:
```javascript
export const MCP_PRESETS = [
  { name: 'sequential-thinking', command: 'npx -y @modelcontextprotocol/server-sequential-thinking' },
  { name: 'os-control', command: 'npx -y @modelcontextprotocol/server-os-control' }
];
```

- [ ] **Step 2: Integrate auto-install**

Update boot flow in `src/presentation/repl.js` to check and install presets if missing.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/mcp/presets.js src/presentation/repl.js
git commit -m "feat: add auto-install MCP presets"
```

---

### Task 3: Context Pruning & Parallel Execution

**Files:**
- Modify: `src/agent/loop.js`

- [ ] **Step 1: Implement context pruning**

Update `src/agent/loop.js` to trim history (keep last 10 messages + summary).

- [ ] **Step 2: Implement parallel tool calls**

Update tool execution loop in `src/agent/loop.js` to use `Promise.all` for multiple tool requests.

- [ ] **Step 3: Commit**

```bash
git add src/agent/loop.js
git commit -m "perf: add context pruning and parallel tool execution"
```
