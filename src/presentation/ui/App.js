import { useState, useEffect } from 'react';
import { Box, useInput, useApp, Text } from 'ink';
import { html } from './htm.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import { ChatView } from './ChatView.js';
import { InputBox } from './InputBox.js';
import { estimateCost } from '../../shared/utils/pricing.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';
import { theme } from './theme.js';
import { executeCommand } from '../../tooling/slashRegistry.js';
import { safeError } from '../../shared/utils/error.js';

const MODES = ['general', 'plan', 'execute'];

export const App = ({ defaultProvider, runAgentWrapper, onExit, version = '0.3.0' }) => {
  const { exit } = useApp();

  const [messages, setMessages] = useState([]);
  const [mode, setMode] = useState('general');
  const [effort, setEffort] = useState('Medium');
  const [isFormulating, setIsFormulating] = useState(false);
  const [toast, setToast] = useState(null);
  const [lastUsage, setLastUsage] = useState(null);

  // Dynamic terminal height
  const [height, setHeight] = useState(process.stdout.rows || 24);
  useEffect(() => {
    const onResize = () => setHeight(process.stdout.rows);
    process.stdout.on('resize', onResize);
    return () => process.stdout.off('resize', onResize);
  }, []);

  const handleExit = () => {
    if (onExit) onExit();
    exit(); // Let Ink handle unmount. repl.js will clean up and process.exit
  };

  // Component-level onProgress handler — available to both slash command handler and runAgentWrapper
  const handleAgentProgress = (event) => {
    if (event.type === 'start_turn') {
      setIsFormulating(true);
    } else if (event.type === 'tool_start') {
      setIsFormulating(false);
      setToast('Running tool: ' + event.tool);
    } else if (event.type === 'stream') {
      setIsFormulating(false);
      const role = event.isSystem ? 'system' : 'agent';
      setMessages((prev) => {
        const newMsgs = [...prev];
        const last = newMsgs[newMsgs.length - 1];
        if (last && last.role === role) {
          last.text += event.chunk;
        } else {
          newMsgs.push({ role, text: event.chunk });
        }
        return newMsgs;
      });
    } else if (event.type === 'token_warning') {
      const { used, max, percent } = event;
      setToast(
        `⚠️ Token ${percent}% terpakai (${used.toLocaleString()}/${max.toLocaleString()}) — sesi ini hampir mencapai batas budget.`,
      );
      setTimeout(() => setToast(null), 8000);
    } else if (event.type === 'memory_compressed') {
      setToast(`🗃️  Memori dipadatkan — ${event.messageCount} pesan tersimpan di arsip`);
      setTimeout(() => setToast(null), 4000);
    } else if (event.type === 'provider_fallback') {
      const { from, reason, next } = event;
      setToast(
        `⚡ Endpoint "${from}" gagal (${reason.substring(0, 50)})` +
          (next ? ` — switching ke "${next}"...` : ` — tidak ada endpoint cadangan.`),
      );
      setTimeout(() => setToast(null), 5000);
    } else if (event.type === 'usage') {
      const cost = estimateCost(event.usage, event.model || '');
      setLastUsage({ usage: event.usage, model: event.model, cost });
    } else if (event.type === 'done') {
      setIsFormulating(false);
      setToast(null);
    }
  };

  useInput((input, key) => {
    console.log(`[DEBUG: App.js useInput] key: ${key?.name}, input: ${input}`);
    if (key.tab) {
      const nextModeIndex = (MODES.indexOf(mode) + 1) % MODES.length;
      setMode(MODES[nextModeIndex]);
      return;
    }
  });

  const handleSubmit = async (text) => {
    if (!text || text.trim() === '') return;

    if (text.toLowerCase() === '/exit' || text.toLowerCase() === '/quit') {
      handleExit();
      return;
    }

    if (text.toLowerCase() === '/clear') {
      setMessages([]);
      setToast(null);
      return;
    }

    // Handle slash commands via registry
    if (text.startsWith('/')) {
      const args = text.slice(1).split(' ');
      const cmd = args[0].toLowerCase();
      const cmdArgs = args.slice(1);

      setIsFormulating(true);
      try {
        const output = await executeCommand(cmd, cmdArgs, { mode, effort });
        handleAgentProgress({ type: 'stream', chunk: output, isSystem: true });
        handleAgentProgress({ type: 'done' });
      } catch (err) {
        const errMsg = safeError(err);
        const output = errMsg.includes('Unknown command')
          ? 'Unknown command: /' + cmd + '. Type /help for available commands.'
          : 'Error: ' + errMsg;
        handleAgentProgress({ type: 'stream', chunk: output, isSystem: true });
        handleAgentProgress({ type: 'done' });
      } finally {
        setIsFormulating(false);
      }
      return;
    }

    const userMessage = { role: 'user', text, mode };
    setMessages((prev) => [...prev, userMessage]);

    if (runAgentWrapper) {
      setIsFormulating(true);
      try {
        await runAgentWrapper({
          input: text,
          mode,
          effort,
          conversationHistory: messages,
          onProgress: handleAgentProgress,
        });
      } catch (err) {
        setIsFormulating(false);
        setToast('Error: ' + safeError(err));
      }
    }
  };

  const isEmpty = messages.length === 0;

  return html`
    <${Box} flexDirection="column" height=${height} width="100%">
      <${Box} position="absolute" top=${0} right=${2}>
        <${Text} color=${theme.colors.dim}>Nythros v${version}<//>
      <//>

      ${
        isEmpty
          ? html`
              <${Box} flexDirection="column" width="100%" alignItems="center">
                <${Box} height=${Math.floor((height - 20) / 2)} />
                <${WelcomeScreen} />
              <//>
            `
          : html`
              <${Box}
                flexDirection="column"
                flexGrow=${1}
                overflowY="hidden"
                justifyContent="flex-end"
              >
                <${ChatView} messages=${messages} maxHeight=${height - 5} lastUsage=${lastUsage} />
              <//>
            `
      }
      ${
        !isEmpty && isFormulating
          ? html`
              <${Box} paddingLeft=${2} marginBottom=${0}>
                <${ThinkingIndicator} />
              <//>
            `
          : null
      }
      ${
        !isEmpty && toast
          ? html`
              <${Box} paddingLeft=${2} marginBottom=${0}>
                <${Text} color=${theme.colors.toolText}>⚡ ${toast}<//>
              <//>
            `
          : null
      }

      <${Box} flexDirection="column" marginTop=${isEmpty ? 0 : 1}>
        ${
          isEmpty
            ? html`
                <${Box} paddingX=${2} marginBottom=${0}>
                  <${Text} color=${theme.colors.dim}>Tips :<//>
                <//>
              `
            : null
        }

        <${InputBox}
          onSubmit=${handleSubmit}
          mode=${mode}
          isFormulating=${isFormulating}
          modelName=${defaultProvider?.model || 'MANHATTAN'}
          provider="Provider"
          effort=${effort}
          onEffortChange=${setEffort}
        />
      <//>

      ${
        isEmpty
          ? html`
              <${Box} justifyContent="center" width="100%" marginTop=${0} marginBottom=${1}>
                <${Text} color=${theme.colors.dim}>Developed by Omnivora<//>
              <//>
            `
          : null
      }
    <//>
  `;
};
