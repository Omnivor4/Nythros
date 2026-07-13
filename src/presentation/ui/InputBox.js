import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { html } from './htm.js';
import { theme } from './theme.js';
import process from 'node:process';
import path from 'node:path';

const SLASH_COMMANDS = [
  { name: '/help', desc: 'Show available slash commands' },
  { name: '/skill', desc: 'Manage GitHub skills' },
  { name: '/config', desc: 'Show Nythros configuration' },
  { name: '/memory', desc: 'View current project memory' },
  { name: '/archive', desc: 'View archived summaries' },
  { name: '/budget', desc: 'Check token budget limit' },
  { name: '/cost', desc: 'View session token usage & estimated cost' },
  { name: '/endpoints', desc: 'List configured endpoints' },
  { name: '/mcp', desc: 'Model Context Protocol integration' },
  { name: '/tools', desc: 'List all active tools' },
  { name: '/mode', desc: 'Show current mode' },
  { name: '/clear', desc: 'Clear the terminal screen' },
  { name: '/python', desc: 'Run Python code snippet' },
  { name: '/exit', desc: 'Exit Nythros' },
];

export const InputBox = ({ onSubmit, mode, modelName, provider, isFormulating, effort = "Medium", onEffortChange }) => {
  const [value, setValue] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSelected, setIsSelected] = useState(false);
  const [pasteData, setPasteData] = useState(null);

  // Blinking cursor effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCursorVisible(v => !v);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const matches = value.startsWith('/') 
    ? SLASH_COMMANDS.filter(cmd => cmd.name.startsWith(value.toLowerCase())) 
    : [];

  const handleEffortClick = () => {
    if (onEffortChange) {
      const EFFORTS = ["Low", "Medium", "High"];
      const next = EFFORTS[(EFFORTS.indexOf(effort) + 1) % EFFORTS.length];
      onEffortChange(next);
    }
  };

  useEffect(() => {
    if (!process.stdin.isTTY) return;

    let pasteBuffer = '';
    let pasteTimer = null;

    const handleData = (data) => {
      const str = data.toString();

      if (str === '\x05') {
        handleEffortClick();
        return;
      }

      if (str === '\x01') {
        setIsSelected(prev => !prev);
        return;
      }
      
      if (str === '\x1b' && pasteData) {
        setPasteData(null);
        setValue('');
        return;
      }

      const isPaste = (str.length > 10 || str.includes('\n'))
        && !str.startsWith('\x1b')
        && !str.startsWith('\x00');

      if (isPaste) {
        clearTimeout(pasteTimer);
        pasteBuffer += str;

        pasteTimer = setTimeout(() => {
          const fullText = pasteBuffer
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();

          if (fullText.length > 0) {
            const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
            const isImagePath = imageExtensions.some(ext =>
              fullText.toLowerCase().endsWith(ext)
            ) && (fullText.startsWith('/') || fullText.startsWith('./') ||
                  fullText.startsWith('../') || fullText.match(/^[A-Za-z]:\\/));

            if (isImagePath) {
              const filename = fullText.split(/[/\\]/).pop();
              setPasteData({
                fullText: `[User melampirkan gambar: ${fullText}]\n\nGunakan tool analyze_image dengan path "${fullText}" untuk melihat detail gambarnya, lalu respons berdasarkan hasil analisis.`,
                isImage: true,
                filename: filename,
                imagePath: fullText
              });
            } else {
              const lines = fullText.split('\n');
              setPasteData({
                fullText,
                lineCount: lines.length,
                charCount: fullText.length,
                isMultiline: lines.length > 1
              });
            }
            setValue('');
          }

          pasteBuffer = '';
        }, 50);
      }
    };

    process.stdin.on('data', handleData);
    return () => {
      process.stdin.off('data', handleData);
      clearTimeout(pasteTimer);
    };
  }, [effort, onEffortChange, pasteData]);

  useInput((input, key) => {
    if (pasteData && !value && (key.backspace || key.delete)) {
      setPasteData(null);
      return;
    }

    if (isSelected) {
      if (key.escape) {
        setIsSelected(false);
        return;
      }
      if (key.backspace || key.delete) {
        setValue('');
        setIsSelected(false);
        return;
      }
      if (key.return) {
        handleSubmit(value);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setValue(input);
        setIsSelected(false);
        return;
      }
    }

    if (matches.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(matches.length - 1, prev + 1));
      }
    }
  });

  const handleChange = (newVal) => {
    setValue(newVal);
  };

  const handleSubmit = (val) => {
    if (isFormulating) return;

    if (pasteData) {
      let finalVal = pasteData.fullText;
      if (val.trim()) {
        if (pasteData.isImage) {
           finalVal = `[User melampirkan gambar: ${pasteData.filename}]\n\nInstruksi user: ${val.trim()}`;
        } else {
           finalVal += '\n\n' + val.trim();
        }
      }
      onSubmit(finalVal);
      setPasteData(null);
      setValue('');
      setSelectedIndex(0);
      setIsSelected(false);
      return;
    }

    if (val.trim()) {
      let finalVal = val.trim();
      if (matches.length > 0 && matches[selectedIndex]) {
        if (finalVal !== matches[selectedIndex].name) {
          finalVal = matches[selectedIndex].name;
        }
      }
      onSubmit(finalVal);
      setValue('');
      setSelectedIndex(0);
      setIsSelected(false);
    }
  };

  useEffect(() => {
    setSelectedIndex(0); // reset selection when typing
  }, [value]);

  const modeColor = mode === "plan" ? theme.colors.plan : mode === "execute" ? theme.colors.execute : theme.colors.general;
  const modeCap = mode.toUpperCase();
  const cwd = process.cwd();
  const shortPath = path.basename(cwd);

  return html`
    <${Box} flexDirection="column" width="100%" paddingX=${2}>

      ${matches.length > 0 ? html`
        <${Box} flexDirection="column" marginBottom=${1} paddingX=${2}>
          <${Text} color=${theme.colors.dim}>Slash Commands:<//>
          ${matches.map((cmd, i) => html`
            <${Box} key=${i}>
              <${Text} color=${i === selectedIndex ? theme.colors.black : theme.colors.accent} backgroundColor=${i === selectedIndex ? theme.colors.accent : undefined} bold>${cmd.name.padEnd(10)}<//>
              <${Text} color=${i === selectedIndex ? theme.colors.white : theme.colors.dim}>  ${cmd.desc}<//>
            <//>
          `)}
        <//>
      ` : null}

      <${Box} flexDirection="row" alignItems="stretch">
        <${Box} width=${1} backgroundColor=${modeColor} />
        <${Box} flexDirection="column" flexGrow=${1} backgroundColor=${isSelected ? theme.colors.bgInputSelected : theme.colors.bgInput} paddingX=${2} paddingY=${1}>
          ${isFormulating 
            ? html`<${Box}><${Text} color=${theme.colors.dim}>Waiting for agent...<//><//>`
            : pasteData
              ? html`
                  <${Box} flexDirection="row" width="100%">
                    <${Box} backgroundColor=${theme.colors.accent} paddingX=${1}>
                      <${Text} color=${theme.colors.black} bold>
                        ${pasteData.isImage 
                          ? `[Image: ${pasteData.filename}]` 
                          : `[Pasted ~${pasteData.isMultiline ? pasteData.lineCount + ' lines' : pasteData.charCount + ' chars'}]`}
                      <//>
                    <//>
                    <${Box} paddingLeft=${1} flexGrow=${1}>
                      <${TextInput} placeholder="(ketik pesan tambahan...)" value=${value} onChange=${handleChange} onSubmit=${handleSubmit} showCursor=${cursorVisible} />
                    <//>
                  <//>
                `
              : isSelected
                ? html`<${Box}><${Text} color=${theme.colors.black} backgroundColor=${theme.colors.bgInputSelected}>${value || ' '}<//><//>`
                : html`<${Box}><${TextInput} placeholder="Ask Anything...................." value=${value} onChange=${handleChange} onSubmit=${handleSubmit} showCursor=${cursorVisible} /><//>`
          }

          <${Box} justifyContent="space-between" marginTop=${1}>
            <${Box}>
              <${Text} color=${theme.colors.white} bold>Models <//>
              <${Text} color=${theme.colors.khaki}>${modelName || 'Provider'}<//>
            <//>
            <${Box}>
              <${Text} color=${theme.colors.dim}>[Tab] Mode: ${mode} · [Ctrl+E] Effort: ${effort}<//>
            <//>
          <//>
        <//>
      <//>
      
      <${Box} alignItems="center">
        <${Box} backgroundColor=${modeColor} paddingX=${1}>
          <${Text} color=${theme.colors.black} bold>${modeCap}<//>
        <//>
        <${Box} marginLeft=${1}>
          <${Text} color=${theme.colors.dim}>${shortPath}<//>
        <//>
      <//>
    <//>
  `;
};
