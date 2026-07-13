import React from 'react';
import { Text, Box } from 'ink';
import { html } from './htm.js';
import { theme } from './theme.js';
import { formatUsage, formatCost } from '../../shared/utils/pricing.js';

function parseAgentText(text) {
  const segments = [];
  const codeBlockRegex = /```[\w]*\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(...parseInlineSegments(text.slice(lastIndex, match.index)));
    }
    segments.push({ type: 'code_block', content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push(...parseInlineSegments(text.slice(lastIndex)));
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

function parseInlineSegments(text) {
  const segments = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (/^[⚠️❌]|^(Warning|Error|WARN|ERROR):/.test(line)) {
      segments.push({ type: 'warning', content: line });
    } else if (/^[✅✓]/.test(line)) {
      segments.push({ type: 'success', content: line });
    } else if (line.includes('`')) {
      const parts = line.split(/(`[^`]+`)/);
      for (const part of parts) {
        if (part.startsWith('`') && part.endsWith('`')) {
          segments.push({ type: 'inline_code', content: part.slice(1, -1) });
        } else if (part) {
          segments.push({ type: 'text', content: part });
        }
      }
    } else {
      segments.push({ type: 'text', content: line });
    }
    segments.push({ type: 'newline' });
  }

  return segments;
}

export const ChatView = ({ messages, maxHeight, lastUsage }) => {
  return html`
    <${Box} flexDirection="column" paddingX=${2} width="100%" marginBottom=${1} maxHeight=${maxHeight}>
      ${messages.map((msg, i) => {
        if (msg.role === 'user') {
          // User messages: simple colored text, no bubble, aligned left
          return html`
            <${Box} key=${i} marginY=${0} width="100%">
              <${Text} color=${theme.colors.userText} bold>You: <//>
              <${Text} color=${theme.colors.khaki}>${msg.text}<//>
            <//>
          `;
        } else if (msg.role === 'system') {
          // System messages (slash command responses)
          return html`
            <${Box} key=${i} marginY=${0} width="100%" paddingLeft=${2}>
              <${Text} color=${theme.colors.systemText}>${msg.text}<//>
            <//>
          `;
        } else {
          // Agent message dengan syntax highlighting
          const segments = parseAgentText(msg.text);
          return html`
            <${Box} key=${i} flexDirection="column" marginY=${1} width="100%">
              <${Text} color=${theme.colors.agentLabel} bold>Nythros:<//> 
              <${Box} paddingLeft=${2} marginTop=${0} flexDirection="column">
                ${segments.map((seg, si) => {
                  if (seg.type === 'code_block') return html`
                    <${Box} key=${si} borderStyle="round"
                            borderColor=${theme.colors.dimBorder}
                            paddingX=${1} marginY=${0}>
                      <${Text} color=${theme.colors.codeBlock}>${seg.content}<//>
                    <//>
                  `;
                  if (seg.type === 'inline_code') return html`
                    <${Text} key=${si} color=${theme.colors.inlineCode} bold>\`${seg.content}\`<//>
                  `;
                  if (seg.type === 'warning') return html`
                    <${Text} key=${si} color=${theme.colors.emphasis}>${seg.content}<//>
                  `;
                  if (seg.type === 'success') return html`
                    <${Text} key=${si} color=${theme.colors.codeBlock}>${seg.content}<//>
                  `;
                  if (seg.type === 'newline') return html`<${Text} key=${si}> <//>`;
                  return html`
                    <${Text} key=${si} color=${theme.colors.agentText} wrap="wrap">
                      ${seg.content}
                    <//>
                  `;
                })}
              <//>
            <//>
          `;
        }
      })}
      
      ${lastUsage && html`
        <${Box} paddingLeft=${2} marginTop=${0} marginBottom=${1}>
          <${Text} color=${theme.colors.dim}>
            ${formatUsage(lastUsage.usage)}
            ${" · "}
            ${formatCost(lastUsage.cost)}
            ${lastUsage.cost?.isEstimate ? " (est.)" : ""}
            ${" · "}
            ${lastUsage.model || ""}
          <//>
        <//>
      `}
    <//>
  `;
};
