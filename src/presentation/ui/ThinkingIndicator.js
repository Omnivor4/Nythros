import { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { html } from './htm.js';
import { theme } from './theme.js';

const FRAMES = [
  '\u28cb',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283c',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280f',
];
const PHRASES = [
  'Compiling',
  'Pathfinding',
  'Brewing',
  'Cogitating',
  'Nythrosing',
  'Spawning',
  'Rendering',
  'Parsing',
  'Indexing',
  'Refactoring',
  'Linking',
  'Bootstrapping',
  'Caching',
  'Buffering',
  'Conjuring',
  'Churning',
  'Sparking',
  'Whirring',
  'Synapsing',
  'Simmering',
];

export const ThinkingIndicator = () => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [phraseIndex] = useState(Math.floor(Math.random() * PHRASES.length));

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  const frame = FRAMES[frameIndex];
  const phrase = PHRASES[phraseIndex];
  const dots = '.'.repeat((frameIndex % 5) + 1);

  return html`
    <${Box} paddingLeft=${2}>
      <${Text} color=${theme.colors.accent}> ${frame} 👑 ${phrase}${dots} <//>
    <//>
  `;
};
