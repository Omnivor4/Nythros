import { Command } from "commander";
import { bootstrap } from "../runtime/bootstrap.js";
import { Agent } from "../agent/Agent.js";
import { startRepl } from "./repl.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      const kernel = await bootstrap();
      const agent = new Agent(kernel);
      
      const events = kernel.getService('events');
      events.on('execution:start', () => console.log('Thinking...'));
      events.on('tool:start', (data) => console.log(`Calling tool: ${data.tool}`));
      
      const result = await agent.process(prompt);
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
      const kernel = await bootstrap();
      await startRepl(kernel, "en");
    } catch (err) {
      console.error("Error starting REPL:", err);
      process.exit(1);
    }
  })();
} else {
  program.parseAsync(process.argv);
}
