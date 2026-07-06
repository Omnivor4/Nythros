export const COLORS = {
  accent: "\x1b[38;2;220;200;168m", // #DCC8A8
  general: "\x1b[38;2;232;131;58m", // #E8833A
  plan: "\x1b[38;2;232;179;57m", // #E8B339
  execute: "\x1b[38;2;232;74;57m", // #E84A39
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgYellow: "\x1b[43m",
  bgGray: "\x1b[48;5;236m",
  bgBlue: "\x1b[44m",
  bgWhite: "\x1b[47m",
  bgRed: "\x1b[41m",
  bgCharcoal: "\x1b[48;2;22;22;15m", // ~#16160F-ish
  pasteAccent: "\x1b[48;2;192;138;82m", // #C08A52
  black: "\x1b[30m",
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  constructor() {
    this.timer = null;
    this.text = "";
    this.frameIndex = 0;
    this.isActive = false; // <-- tambah ini
  }

  start(text) {
    this.text = text;
    this.frameIndex = 0;

    if (!process.stdout.isTTY) {
      console.log(this.text + "..."); // print sekali, selesai
      return;
    }

    this.isActive = true; // <-- set true hanya kalau TTY
    if (this.timer) clearInterval(this.timer);
    
    // Hide cursor
    process.stdout.write("\x1b[?25l");
    
    this.timer = setInterval(() => {
      this.render();
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
    }, 80);
  }

  update(text) {
    this.text = text;
    if (this.isActive) this.render(); // <-- guard dengan isActive
  }

  render() {
    if (!this.isActive) return;
    const frame = FRAMES[this.frameIndex];
    // Clear line and move to column 1
    process.stdout.write(`\x1b[2K\x1b[1G${COLORS.accent}${frame}${COLORS.reset} ${this.text}`);
  }

  stop(finalText = "", type = "success") {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    const wasActive = this.isActive;
    this.isActive = false; // <-- reset
    
    if (wasActive) {
      // Show cursor
      process.stdout.write("\x1b[?25h");
      // Clear the spinner line
      process.stdout.write("\x1b[2K\x1b[1G");
    }
    
    if (finalText) {
      const icon = type === "success" ? `${COLORS.green}✔${COLORS.reset}` :
                   type === "error" ? `${COLORS.red}✖${COLORS.reset}` : 
                   type === "info" ? `${COLORS.cyan}ℹ${COLORS.reset}` : "";
      console.log(`${icon} ${finalText}`);
    }
  }
}

export function highlightMarkdown(text) {
  if (!text) return "";
  
  let highlighted = text;
  
  // Highlight inline code `code`
  highlighted = highlighted.replace(/`([^`]+)`/g, `${COLORS.cyan}$1${COLORS.reset}`);
  
  // Highlight bold **text**
  highlighted = highlighted.replace(/\*\*([^*]+)\*\*/g, `${COLORS.bold}$1${COLORS.reset}`);
  
  // Highlight headers # Header
  highlighted = highlighted.replace(/^(#+)\s+(.*)$/gm, `${COLORS.accent}${COLORS.bold}$1 $2${COLORS.reset}`);
  
  return highlighted;
}
