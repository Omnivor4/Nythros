import { Command } from "commander";
import { Agent } from "../agent/Agent.js";
import { startRepl } from "./repl.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../shared/config.js";

const __filename = fs.realpathSync(fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);
const pkgInfo = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf-8"));

const program = new Command();
program.name("nythros").description("BYOK AI coding agent CLI (Refactored Phase 2)").version(pkgInfo.version);

program
  .command("chat <prompt>")
  .description("Send a single prompt to the agent")
  .action(async (prompt) => {
    try {
      const config = loadConfig();
      const agent = new Agent(config);

      const result = await agent.process(prompt, {
        onProgress: (evt) => {
          if (evt.type === 'tool_start') console.log(`Calling tool: ${evt.tool}`);
        }
      });
      console.log('\n', result.text);
    } catch (err) {
      console.error('Error during chat:', err.message);
    }
  });

program
  .command("config")
  .description("Manage configuration (Not implemented in refactored version yet)")
  .action(() => {
    console.log("Config command to be migrated.");
  });

if (process.argv.length <= 2) {
  if (!process.stdout.isTTY) {
    console.error("Non-interactive mode detected. Please use 'nythros chat \"prompt\"' when piping data.");
    process.exit(1);
  }

  (async () => {
    try {
      await startRepl("en");
    } catch (err) {
      console.error("Error starting REPL:", err);
      process.exit(1);
    }
  })();
} else {
  program.parseAsync(process.argv);
}
