// Banner CLI Nythros — Hermes Agent style full-width terminal banner
import { COLORS } from './ui.js';

const DIM = COLORS.dim;
const RESET = COLORS.reset;

// Massive full-width ASCII art logo (Hermes-style block letters)
// with Kancil mascot on the left
const LOGO_ICON = [
  '    ^   ^   ^   ',
  '   / \\ / \\ / \\ ',
  '  |             |',
  '  |   ( )   ( ) |',
  '   \\___________/ ',
  '    \\_________ / ',
];

const WORDMARK = [
  ' ███╗   ██╗██╗   ██╗████████╗██╗  ██╗██████╗  ██████╗ ███████╗',
  ' ████╗  ██║╚██╗ ██╔╝╚══██╔══╝██║  ██║██╔══██╗██╔═══██╗██╔════╝',
  ' ██╔██╗ ██║ ╚████╔╝    ██║   ███████║██████╔╝██║   ██║███████╗',
  ' ██║╚██╗██║  ╚██╔╝     ██║   ██╔══██║██╔══██╗██║   ██║╚════██║',
  ' ██║ ╚████║   ██║      ██║   ██║  ██║██║  ██║╚██████╔╝███████║',
  ' ╚═╝  ╚═══╝   ╚═╝      ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
];

export async function printAnimatedBanner() {
  console.clear();

  // Render Logo and Wordmark side-by-side
  for (let i = 0; i < WORDMARK.length; i++) {
    const iconLine = LOGO_ICON[i] || ' '.repeat(LOGO_ICON[0].length);
    process.stdout.write(`${COLORS.accent}${iconLine} ${WORDMARK[i]}${COLORS.reset}\n`);
  }

  process.stdout.write(`\n${DIM}Developed by Omnivora${RESET}\n\n`);
}
