// Banner CLI Nythros — Hermes Agent style full-width terminal banner
import { t } from "./i18n.js";
import { COLORS } from "./ui.js";

const ACCENT = COLORS.accent;
const DIM = COLORS.dim;
const BOLD = COLORS.bold;
const YELLOW = COLORS.yellow;
const RED = COLORS.red;
const RESET = COLORS.reset;
const CYAN = COLORS.cyan;
const WHITE = COLORS.white;
const GRAY = COLORS.gray;
const GREEN = COLORS.green;

// Massive full-width ASCII art logo (Hermes-style block letters)
// with Kancil mascot on the left
const LOGO_ICON = [
  "    ^   ^   ^   ",
  "   / \\ / \\ / \\ ",
  "  |             |",
  "  |   ( )   ( ) |",
  "   \\___________/ ",
  "    \\_________ / ",
];

const WORDMARK = [
  " ███╗   ██╗██╗   ██╗████████╗██╗  ██╗██████╗  ██████╗ ███████╗",
  " ████╗  ██║╚██╗ ██╔╝╚══██╔══╝██║  ██║██╔══██╗██╔═══██╗██╔════╝",
  " ██╔██╗ ██║ ╚████╔╝    ██║   ███████║██████╔╝██║   ██║███████╗",
  " ██║╚██╗██║  ╚██╔╝     ██║   ██╔══██║██╔══██╗██║   ██║╚════██║",
  " ██║ ╚████║   ██║      ██║   ██║  ██║██║  ██║╚██████╔╝███████║",
  " ╚═╝  ╚═══╝   ╚═╝      ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝",
];

export async function printAnimatedBanner({ version, tools = [], skills = [], language = "en", model = "", sessionId = "" }) {
  const cols = process.stdout.columns || 120;
  console.clear();

  // Render Logo and Wordmark side-by-side
  for (let i = 0; i < WORDMARK.length; i++) {
    const iconLine = LOGO_ICON[i] || " ".repeat(LOGO_ICON[0].length);
    process.stdout.write(`${COLORS.accent}${iconLine} ${WORDMARK[i]}${COLORS.reset}\n`);
  }
  
  process.stdout.write(`\n${DIM}Developed by Omnivora${RESET}\n\n`);
}
