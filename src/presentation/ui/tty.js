import readline from "node:readline";
import { execSync } from "node:child_process";
import { COLORS } from "../utils/ui.js";

const ESC = "\u001B[";

export class TerminalUI {
  constructor() {
    this.history = []; // Messages printed above
    this.input = "";
    this.cursorPos = 0;
    
    this.toast = null; // Toast state
    
    this.dropdownOptions = [];
    this.dropdownSelected = 0;
    this.showDropdown = false;
    
    this.statusText = "Nythros";
    this.modelName = "";
    this.tokenCount = "0";
    this.maxTokens = "256K";
    this.elapsedTime = "0s";
    this.aiTime = "0s";
    this.verifyTime = "0s";
    this.isFormulating = false;
    this.streamText = "";
    
    this.currentMode = "general"; // general -> plan -> execute
    this.messageHistory = []; // { text, mode, timestamp }
    this.loadingPhrases = ["Breewing", "Steeping", "Distilling", "Brewing up", "Cooking"];
    this.loadingIndex = 0;
    this.loadingTimer = null;
    this.loadingFrame = 0;

    this.height = process.stdout.rows;
    this.width = process.stdout.columns;
    
    // For cleaning up previous render
    this.lastRenderLines = 0;

    // Callbacks
    this.onSubmit = null;
    this.onInterrupt = null;
    
    // Timer for elapsed tracking
    this.startTime = Date.now();
  }

  showToast(message, durationMs = 2000) {
    this.toast = { message, expiresAt: Date.now() + durationMs };
    this.render();
    
    setTimeout(() => {
      this.toast = null;
      this.render();
    }, durationMs);
  }

  start() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdout.write("\x1b[?2004h");
      process.on("exit", () => {
        process.stdout.write("\x1b[?2004l");
      });
    }
    readline.emitKeypressEvents(process.stdin);
    this.keyListener = this.handleKeypress.bind(this);
    this.dataListener = this.handleRawData.bind(this);
    process.stdin.on("keypress", this.keyListener);
    process.stdin.on("data", this.dataListener);
    
    process.stdin.resume(); // Prevent Node from exiting due to rl.close() pausing stdin
    
    process.stdout.on("resize", () => {
      this.height = process.stdout.rows;
      this.width = process.stdout.columns;
      this.render();
    });

    this.render();
  }

  stop() {
    this.active = false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?2004l");
    }
    if (this.keyListener) {
      process.stdin.removeListener("keypress", this.keyListener);
    }
    if (this.dataListener) {
      process.stdin.removeListener("data", this.dataListener);
    }
    // Instead of scrolling exactly lastRenderLines (which can push UI out of view if large),
    // we just move the cursor down safely so the prompt remains visible.
    process.stdout.write(`\n`);
  }

  handleRawData(data) {
    // Paste logic: \x1b[200~ ... \x1b[201~
    const str = data.toString();
    if (str.includes("\x1b[200~")) {
      this.isPasting = true;
      this.pasteBuffer = "";
      return;
    }
    if (str.includes("\x1b[201~")) {
      this.isPasting = false;
      this.processPaste(this.pasteBuffer);
      this.pasteBuffer = "";
      return;
    }
    if (this.isPasting) {
      this.pasteBuffer += str;
      return;
    }
  }

  processPaste(text) {
    if (!this.pastedBlocks) this.pastedBlocks = new Map();
    const id = Date.now().toString() + Math.random();
    const lines = text.split('\n').length;
    
    // Gunakan placeholder ringkas: [Pasted ~N lines]
    const placeholder = `[Pasted ~${lines} lines]`;
    this.pastedBlocks.set(id, { text, placeholder });
    
    this.input = this.input.slice(0, this.cursorPos) + placeholder + this.input.slice(this.cursorPos);
    this.cursorPos += placeholder.length;
    this.render();
  }

  setDropdown(options) {
    if (options && options.length > 0) {
      this.dropdownOptions = options;
      this.dropdownSelected = 0;
      this.showDropdown = true;
    } else {
      this.showDropdown = false;
      this.dropdownOptions = [];
    }
    this.render();
  }

  setStatus(text) {
    this.statusText = text;
    this.render();
  }

  setFormulating(isFormulating) {
    this.isFormulating = isFormulating;
    if (isFormulating) {
        this.loadingIndex = Math.floor(Math.random() * this.loadingPhrases.length);
        this.loadingTimer = setInterval(() => {
            this.loadingFrame = (this.loadingFrame + 1) % 5;
            this.render();
        }, 400);
    } else {
        clearInterval(this.loadingTimer);
    }
    this.render();
  }

  appendStream(text) {
    this.streamText += text;
    this.render();
  }

  clearStream() {
    this.streamText = "";
    this.render();
  }

  printMessage(text, isAi = false) {
    this.clearUI();
    const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, "");
    
    // Collapse if long
    let lines = text.split('\n');
    let collapsed = false;
    if (isAi && lines.length > 36) {
        collapsed = true;
        const head = lines.slice(0, 10);
        const tail = `~Read more ${lines.length - 10} lines`;
        lines = [...head, tail];
    }

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (isAi && i === 0) line = ` 👑 ${line}`; // Crown icon for Nythros
        else if (isAi) line = `    ${line}`; // Padding

        const visibleLen = stripAnsi(line).length;
        process.stdout.write(line);
        if (!(visibleLen > 0 && visibleLen % this.width === 0)) process.stdout.write("\n");
    }
    this.render();
  }

  clearUI() {
    if (this.lastRenderLines <= 0) return;

    const downRows = this.cursorUpRows || 0;
    if (downRows > 0) {
      process.stdout.write(`\x1b[${downRows}B`);
    }

    const linesUp = Math.min(this.lastRenderLines - 1, this.height - 1);
    if (linesUp > 0) {
      process.stdout.write(`\x1b[${linesUp}A`);
    }

    process.stdout.write("\x1b[1G");
    process.stdout.write("\x1b[0J"); 
    this.lastRenderLines = 0;
    this.cursorUpRows = 0;
  }

  render() {
    this.clearUI();

    let linesToDraw = [];
    const addLine = (str, visibleLen) => {
      linesToDraw.push({ str, visibleLen });
    };

    const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, "");

    // 1. Buffering / Streaming Area
    if (this.isFormulating) {
      const phrase = this.loadingPhrases[this.loadingIndex];
      const dots = ".".repeat((this.loadingFrame % 5) + 1);
      const text = ` 👑 ${phrase}${dots}`;
      addLine(`${COLORS.accent}${text}${COLORS.reset}`, text.length);
    }
    if (this.streamText) {
      const lines = this.streamText.split('\n');
      for (const line of lines) {
        addLine(`${COLORS.gray}${line}${COLORS.reset}`, stripAnsi(line).length);
      }
    }

    // 2. Dropdown
    if (this.showDropdown) {
      addLine("", 0); // empty line
      for (let i = 0; i < this.dropdownOptions.length; i++) {
        const lbl = this.dropdownOptions[i].label.padEnd(40);
        if (i === this.dropdownSelected) {
          addLine(`${COLORS.bgBlue}${COLORS.white} > ${lbl} ${COLORS.reset}`, lbl.length + 3 + 1);
        } else {
          addLine(`   ${lbl} `, lbl.length + 4);
        }
      }
    }

    // 3. Input Box
    let color = this.currentMode === "plan" ? COLORS.plan : this.currentMode === "execute" ? COLORS.execute : COLORS.general;
    
    const bg = COLORS.bgCharcoal;
    
    // Dynamic top bar len so it's EXACTLY this.width
    const topBarLen = Math.max(0, this.width - 2); 
    addLine(`${bg}${color}╭─${"─".repeat(topBarLen)}╮${COLORS.reset}`, this.width);
    
    // Render History (Right-aligned user messages)
    for (const msg of this.messageHistory) {
        const msgColor = msg.mode === "plan" ? COLORS.plan : msg.mode === "execute" ? COLORS.execute : COLORS.general;
        // Right align: total width - length - border padding
        const pad = Math.max(0, this.width - msg.text.length - 2);
        addLine(`${bg}${msgColor}│${" ".repeat(pad)}${msg.text}│${COLORS.reset}`, this.width);
    }
    
    addLine(`${bg}${color}│${COLORS.reset}${bg} You:${" ".repeat(Math.max(0, this.width - 8))}│${COLORS.reset}`, this.width);
      
      // Prompt Input Line
      let renderedInput = this.input;
      if (this.selectedAll) {
        renderedInput = `\x1b[7m${this.input}\x1b[27m`;
      }
      
      // Highlight placeholders
      if (this.pastedBlocks) {
          for (const { placeholder } of this.pastedBlocks.values()) {
              if (renderedInput.includes(placeholder)) {
                  const badge = `${COLORS.pasteAccent}${COLORS.black} ${placeholder} \x1b[100m ${COLORS.reset}`;
                  renderedInput = renderedInput.replace(placeholder, badge);
              }
          }
      }
      
      const inputVisible = "╰─> " + this.input;
      addLine(`${bg}${color}╰─>${COLORS.reset}${bg} ${renderedInput}\x1b[K${COLORS.reset}`, stripAnsi(inputVisible).length);
      
      // Badge mode (GENERAL/PLAN/EXECUTE)
      const mode = this.currentMode.toUpperCase();
      const modeColor = this.currentMode === "plan" ? COLORS.plan : this.currentMode === "execute" ? COLORS.execute : COLORS.general;
      const badge = `${COLORS.bgYellow}${COLORS.black} ${mode} ${COLORS.reset}`;
      addLine(`${badge} `, badge.length + 1);

    // 4. Status Bar
    const statusBg = COLORS.bgCharcoal;
    const statusFg = "\x1b[38;5;253m";
    
    // Toast render
    if (this.toast) {
      // Right-aligned relative to input box (approx width)
      const padding = Math.max(0, this.width - this.toast.message.length - 6);
      addLine(`${" ".repeat(padding)} ${COLORS.pasteAccent}${COLORS.black} 👑 ${this.toast.message} ${COLORS.reset} `, this.width);
    }
    
    // Path context (bottom-right)
    const path = process.cwd();
    const pathShort = path.length > 20 ? "..." + path.slice(-17) : path;
    
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m` : `${elapsed}s`;
    
    let leftStatus = ` 🦌NYTHROS `;
    let middleStatus = `| ${this.modelName || "model"} | ${elapsedStr} `;
    let rightStatus = `| ${this.currentMode.toUpperCase()} | ${pathShort} `;
    
    // We make the status bar exactly width - 1 characters long
    let spaces = this.width - leftStatus.length - middleStatus.length - rightStatus.length - 1;
    spaces = Math.max(0, spaces);
    
    const statusBarStr = `${statusBg}${statusFg}${leftStatus}${middleStatus}${" ".repeat(spaces)}${rightStatus} \x1b[K${COLORS.reset}`;
    addLine(statusBarStr, leftStatus.length + middleStatus.length + spaces + rightStatus.length + 1);

    // Build the final output string and calculate drawn lines
    let output = "";
    let linesDrawn = 0;
    for (let i = 0; i < linesToDraw.length; i++) {
      const line = linesToDraw[i];
      output += line.str;
      
      const wrappedLines = Math.ceil(line.visibleLen / this.width) || 1;
      linesDrawn += wrappedLines;
      
      const isExactWidth = (line.visibleLen > 0) && (line.visibleLen % this.width === 0);
      
      if (i < linesToDraw.length - 1) {
        if (!isExactWidth) {
          output += "\n";
        }
      }
    }

    // Print everything
    process.stdout.write(output);
    this.lastRenderLines = linesDrawn;

    // Move cursor back to input position
    const cursorGlobalX = 4 + this.cursorPos; // 4 is "╰─> " length
    const inputWrappedLines = Math.ceil((this.input.length + 4) / this.width) || 1;
    const cursorRowOffset = Math.floor(cursorGlobalX / this.width);
    const cursorCol = (cursorGlobalX % this.width) + 1; // 1-indexed for ANSI

    // We are at the end of the status bar. The input box occupies `inputWrappedLines` rows.
    // The cursor should go UP by: (inputWrappedLines - cursorRowOffset) rows.
    this.cursorUpRows = Math.max(1, inputWrappedLines - cursorRowOffset);
    process.stdout.write(ESC + this.cursorUpRows + "A");
    process.stdout.write(ESC + Math.max(1, cursorCol) + "G"); // Column absolute
  }

  handleKeypress(str, key) {
    const now = Date.now();
    const isPaste = this.lastKeyTime && (now - this.lastKeyTime < 15);
    this.lastKeyTime = now;

    // B1. Image Paste (win32)
    if (this.input === "/paste-image" && key && key.name === "return") {
        if (process.platform === "win32") {
             try {
                const tempFile = `C:\\Users\\USER\\AppData\\Local\\Temp\\nythros_clip_${Date.now()}.png`;
                execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Clipboard]::ContainsImage()) { [System.Windows.Forms.Clipboard]::GetImage().Save('${tempFile}', [System.Drawing.Imaging.ImageFormat]::Png) }"`, { stdio: 'ignore' });
                this.input = `[Image attached: ${tempFile}]`;
                this.cursorPos = this.input.length;
                this.render();
                return;
             } catch (e) {
                this.printMessage(`\n${COLORS.red}❌ Image paste failed: ${e.message}${COLORS.reset}\n`);
                return;
             }
        } else {
             this.printMessage(`\n${COLORS.yellow}Image paste only supported on Windows.${COLORS.reset}\n`);
             return;
        }
    }
    
    // Absolute block for Tab and Shift+Tab to prevent UI shrinking bugs in PowerShell/CMD
    if ((key && key.name === "tab") || str === "\x1B[Z") {
      if ((key && key.shift) || str === "\x1B[Z") {
        if (this.currentMode === "general") this.currentMode = "plan";
        else if (this.currentMode === "plan") this.currentMode = "execute";
        else this.currentMode = "general";
        this.render();
      }
      return;
    }

    if (key && key.ctrl && key.name === "c") {
      // Copy to clipboard instead of exiting
      try {
        const textToCopy = this.selectedAll ? this.input : this.input.slice(0, this.cursorPos);
        if (textToCopy) {
          if (process.platform === "win32") {
            execSync(`powershell -command "Set-Clipboard -Value '${textToCopy.replace(/'/g, "''")}'"`, { stdio: 'ignore' });
          } else if (process.platform === "darwin") {
            execSync(`echo "${textToCopy}" | pbcopy`, { stdio: 'ignore' });
          } else {
            execSync(`echo "${textToCopy}" | xclip -selection clipboard`, { stdio: 'ignore' });
          }
          this.printMessage(`\n${COLORS.green}✅ Text berhasil di-copy ke clipboard!${COLORS.reset}\n`);
        }
      } catch (e) {
        this.printMessage(`\n${COLORS.red}❌ Gagal copy ke clipboard: ${e.message}${COLORS.reset}\n`);
      }
      return;
    }

    // Select All (Ctrl+A)
    if (key && key.ctrl && key.name === "a") {
      if (this.input.length > 0) {
        this.selectedAll = !this.selectedAll; // Toggle instead of set
        this.render();
      }
      return;
    }

    // Ctrl+V OS Clipboard Integration
    if (key && key.ctrl && key.name === "v") {
      try {
        let clip = "";
        if (process.platform === "win32") {
          clip = execSync('powershell -command "Get-Clipboard"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        } else if (process.platform === "darwin") {
          clip = execSync('pbpaste', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        } else {
          clip = execSync('xclip -selection clipboard -o', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        }
        clip = clip.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
        
        // Use same logic as processPaste for consistency
        if (!this.pastedBlocks) this.pastedBlocks = new Map();
        const lines = clip.split('\n').length;
        
        if (lines === 1 && clip.length < 200) {
          if (this.selectedAll) {
            this.input = clip;
            this.cursorPos = clip.length;
            this.selectedAll = false;
          } else {
            this.input = this.input.slice(0, this.cursorPos) + clip + this.input.slice(this.cursorPos);
            this.cursorPos += clip.length;
          }
        } else {
          const id = Date.now().toString() + Math.random();
          const placeholder = `[Pasted ~${lines} lines]`;
          this.pastedBlocks.set(id, { text: clip, placeholder });
          
          if (this.selectedAll) {
            this.input = placeholder;
            this.cursorPos = placeholder.length;
            this.selectedAll = false;
          } else {
            this.input = this.input.slice(0, this.cursorPos) + placeholder + this.input.slice(this.cursorPos);
            this.cursorPos += placeholder.length;
          }
        }
        this.render();
      } catch (e) {
        // Fallback or ignore if no clipboard access
      }
      return;
    }

    if (key && key.name === "return") {
      // Prevent multi-line paste from triggering rapid multiple submissions
      if (isPaste) {
        // If pasted block pending, avoid inserting extra space
        if (this.pastedBlocks && this.pastedBlocks.size > 0) {
          this.render();
          return;
        }
        this.input = this.input.slice(0, this.cursorPos) + " " + this.input.slice(this.cursorPos);
        this.cursorPos++;
        this.render();
        return;
      }
      if (this.showDropdown) {
        // Autocomplete
        const selected = this.dropdownOptions[this.dropdownSelected];
        this.input = selected.value + " ";
        this.cursorPos = this.input.length;
        this.showDropdown = false;
        this.render();
      } else {
        const submitted = this.input;
        this.input = "";
        this.cursorPos = 0;
        this.showDropdown = false;
        this.clearUI();
        if (this.onSubmit) {
          this.messageHistory.push({ text: submitted, mode: this.currentMode, timestamp: Date.now() });
          this.history.push(submitted);
          if (this.history.length > 50) this.history.shift(); // Bug 6: History Memory Leak
          this.historyIndex = 0;
          this.onSubmit(submitted);
        }
        else this.render();
      }
      return;
    }

    if (this.showDropdown) {
      if (key.name === "up") {
        this.dropdownSelected = Math.max(0, this.dropdownSelected - 1);
        this.render();
        return;
      }
      if (key.name === "down") {
        this.dropdownSelected = Math.min(this.dropdownOptions.length - 1, this.dropdownSelected + 1);
        this.render();
        return;
      }
    } else {
      // Bug 3 & 4: Missing Up/Down History Navigation
      if (key.name === "up") {
        if (this.historyIndex < this.history.length) {
          this.historyIndex++;
          this.input = this.history[this.history.length - this.historyIndex];
          this.cursorPos = this.input.length;
          this.render();
        }
        return;
      }
      if (key.name === "down") {
        if (this.historyIndex > 1) {
          this.historyIndex--;
          this.input = this.history[this.history.length - this.historyIndex];
          this.cursorPos = this.input.length;
          this.render();
        } else if (this.historyIndex === 1) {
          this.historyIndex = 0;
          this.input = "";
          this.cursorPos = 0;
          this.render();
        }
        return;
      }
    }

    if (key.name === "left") {
      this.selectedAll = false;
      if (key.ctrl) {
        // Jump word left
        const match = this.input.slice(0, this.cursorPos).match(/\S+\s*$/);
        this.cursorPos = match ? this.cursorPos - match[0].length : 0;
      } else {
        this.cursorPos = Math.max(0, this.cursorPos - 1);
      }
      this.render();
      return;
    }
    if (key.name === "right") {
      this.selectedAll = false;
      if (key.ctrl) {
        // Jump word right
        const match = this.input.slice(this.cursorPos).match(/^\s*\S+/);
        this.cursorPos = match ? this.cursorPos + match[0].length : this.input.length;
      } else {
        this.cursorPos = Math.min(this.input.length, this.cursorPos + 1);
      }
      this.render();
      return;
    }
    if (key.name === "home") {
      this.selectedAll = false;
      this.cursorPos = 0;
      this.render();
      return;
    }
    if (key.name === "end") {
      this.selectedAll = false;
      this.cursorPos = this.input.length;
      this.render();
      return;
    }
    if (key.name === "backspace") {
      if (this.selectedAll) {
        this.input = "";
        this.cursorPos = 0;
        this.selectedAll = false;
      } else if (this.cursorPos > 0) {
        this.input = this.input.slice(0, this.cursorPos - 1) + this.input.slice(this.cursorPos);
        this.cursorPos--;
      }
    } else if (key.name === "delete") {
      if (this.selectedAll) {
        this.input = "";
        this.cursorPos = 0;
        this.selectedAll = false;
      } else if (this.cursorPos < this.input.length) {
        this.input = this.input.slice(0, this.cursorPos) + this.input.slice(this.cursorPos + 1);
      }
    } else if (str) {
      // Bug 1 & 2: Shift+Tab UI Shrink & Tab Cursor Desync
      if (str === "\x1B[Z" || key.name === "tab") return;
      
      if (this.selectedAll) {
        this.input = "";
        this.cursorPos = 0;
        this.selectedAll = false;
      }
      
      // Bug 5: Paste ANSI Breakage
      let cleanStr = str.replace(/\r\n/g, " ").replace(/\n/g, " ");
      cleanStr = cleanStr.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ""); // Strip ANSI
      this.input = this.input.slice(0, this.cursorPos) + cleanStr + this.input.slice(this.cursorPos);
      this.cursorPos += cleanStr.length;
    }

    // Dynamic dropdown logic — English labels
    if (this.input.startsWith("/")) {
      const cmds = [
        { label: "/help    - Show help", value: "/help" },
        { label: "/clear   - Clear screen", value: "/clear" },
        { label: "/skill   - Manage skills", value: "/skill" },
        { label: "/config  - Manage configuration", value: "/config" },
        { label: "/memory  - View project memory", value: "/memory" },
        { label: "/mcp     - Model Context Protocol", value: "/mcp" },
        { label: "/exit    - Exit Nythros", value: "/exit" }
      ];
      const match = cmds.filter(c => c.value.startsWith(this.input));
      if (match.length > 0) {
        this.setDropdown(match);
      } else {
        this.setDropdown([]);
      }
    } else {
      this.showDropdown = false;
    }

    this.render();
  }
}
