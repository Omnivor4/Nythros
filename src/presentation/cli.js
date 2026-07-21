import { Command } from "commander";
import { Agent } from "../agent/Agent.js";
import { startRepl } from "./repl.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig } from "../shared/config.js";

const __filename = fs.realpathSync(fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);
const pkgInfo = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf-8"));

// SIGINT/SIGTERM hanya di-handle di REPL (startRepl) biar runShutdown jalan.
// Di mode single-command, default Node behavior (kill process) sudah cukup.

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(query, answer => { rl.close(); resolve(answer.trim()); });
  });
}

const program = new Command();
program
  .name("nythros")
  .description("BYOK AI coding agent CLI — lokal, extensible, game-dev ready")
  .version(pkgInfo.version, "-v, --version", "Tampilkan versi Nythros");

// Custom help dengan contoh pemakaian
program.addHelpText('after', `
Contoh Pemakaian:
  $ nythros                         Masuk ke REPL interaktif
  $ nythros chat "jelasin kode ini"  Kirim prompt langsung
  $ nythros setup                   Setup endpoint AI interaktif
  $ nythros config --show           Lihat konfigurasi saat ini
  $ nythros config --key sk-xxx     Set API Key dari CLI
  $ nythros -v                      Lihat versi
  $ nythros -h                      Tampilkan bantuan ini

Dokumentasi lengkap: ${pkgInfo.repository?.url || 'https://github.com/omnivora/nythros'}
`);

program
  .command("version")
  .description("Tampilkan versi Nythros")
  .action(() => {
    console.log(`Nythros v${pkgInfo.version}`);
    console.log(`Node.js ${process.version}`);
    console.log(`Platform: ${process.platform}`);
  });

program
  .command("chat <prompt>")
  .description("Send a single prompt to the agent")
  .action(async (prompt) => {
    try {
      const config = loadConfig();
      const agent = new Agent(config);

      // Streaming progress biar keliatan live
      process.stdout.write('\n');
      const result = await agent.process(prompt, {
        onProgress: (evt) => {
          if (evt.type === 'stream') {
            process.stdout.write(evt.chunk);
          } else if (evt.type === 'tool_start') {
            process.stdout.write(`\n🔧 ${evt.tool}... `);
          } else if (evt.type === 'tool_end') {
            process.stdout.write(`✓\n`);
          }
        }
      });
      if (result.text) {
        process.stdout.write('\n\n');
        console.log(result.text);
      }
      if (result.usage) {
        const { prompt_tokens: p, completion_tokens: c, total_tokens: t } = result.usage;
        console.log(`\n(↑${p.toLocaleString()} ↓${c.toLocaleString()} · ${t.toLocaleString()} tokens)`);
      }
    } catch (err) {
      console.error('\nError:', err.message);
    }
  });

program
  .command("setup")
  .description("Konfigurasi endpoint AI secara interaktif")
  .action(async () => {
    try {
      const config = loadConfig();
      const ep = config.endpoints?.[0] || {};

      console.log('\n🔧 Setup Endpoint AI\n');
      console.log('(Isi回车 untuk pakai nilai default yang ada)\n');

      const baseURL = await askQuestion(`Base URL [${ep.base_url || 'https://openrouter.ai/api/v1'}]: `);
      const apiKey = await askQuestion(`API Key [${ep.api_key ? '***sudah terisi***' : 'kosong'}]: `);
      const model = await askQuestion(`Model [${ep.model || 'anthropic/claude-sonnet-4'}]: `);

      config.endpoints = [{
        id: ep.id || 'openai',
        name: ep.name || 'OpenAI Compatible',
        base_url: baseURL || ep.base_url || 'https://openrouter.ai/api/v1',
        api_key: apiKey || ep.api_key || '',
        model: model || ep.model || 'anthropic/claude-sonnet-4',
        supports_vision: true,
        supports_tools: true,
        priority: 1
      }];

      saveConfig(config);
      console.log('\n✅ Konfigurasi tersimpan di ~/.nythros/config.json\n');

      // Verify koneksi: langsung fetch ke {baseURL}/models
      console.log('⏳ Verifikasi endpoint...');
      try {
        const { OpenAICompatibleProvider } = await import('../providers/openaiCompatible.js');
        const verifyProvider = new OpenAICompatibleProvider({
          apiKey: config.endpoints[0].api_key,
          model: config.endpoints[0].model,
          baseURL: config.endpoints[0].base_url
        });
        await verifyProvider.verify();
        console.log('✅ Endpoint valid dan terhubung!\n');
      } catch (err) {
        console.log(`⚠️  Gagal verifikasi: ${err.message}`);
        console.log('Konfigurasi tetap tersimpan, tapi cek lagi Base URL / API Key kamu.\n');
      }
    } catch (err) {
      console.error('\nError:', err.message);
    }
  });

program
  .command("doctor")
  .description("Diagnostic — cek config, endpoint, dan saran perbaikan")
  .option("--fix", "Perbaiki masalah yang ditemukan secara interaktif")
  .option("--json", "Output JSON untuk machine-readable (CI/script)")
  .option("--verbose", "Tampilkan detail tambahan (model list, raw config)")
  .action(async (options) => {
    const { runDoctor, doctorFix, runDoctorJSON } = await import("./doctor.js");
    if (options.fix) {
      await doctorFix();
    } else if (options.json) {
      await runDoctorJSON();
    } else if (options.verbose) {
      await runDoctor(true);
    } else {
      await runDoctor();
    }
  });

program
  .command("config")
  .description("Atur konfigurasi endpoint AI")
  .option("--provider <name>", "Nama/ID endpoint (default: openai)")
  .option("--base-url <url>", "Base URL endpoint")
  .option("--key <key>", "API Key")
  .option("--model <name>", "Nama model")
  .option("--show", "Tampilkan konfigurasi saat ini")
  .action(async (options) => {
    try {
      if (options.show) {
        const cfg = loadConfig();
        // Mask keys
        if (cfg.endpoints) {
          cfg.endpoints = cfg.endpoints.map(ep => ({
            ...ep,
            api_key: ep.api_key ? '***' : '(not set)'
          }));
        }
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }

      const config = loadConfig();
      const ep = config.endpoints?.[0] || {};

      config.endpoints = [{
        id: options.provider || ep.id || 'openai',
        name: options.provider || ep.name || 'OpenAI Compatible',
        base_url: options.baseUrl || ep.base_url || '',
        api_key: options.key || ep.api_key || '',
        model: options.model || ep.model || '',
        supports_vision: true,
        supports_tools: true,
        priority: 1
      }];

      saveConfig(config);
      console.log('✅ Konfigurasi endpoint tersimpan.');

      if (config.endpoints[0].base_url && config.endpoints[0].api_key) {
        console.log('⏳ Verifikasi...');
        try {
          const { OpenAICompatibleProvider } = await import('../providers/openaiCompatible.js');
          const v = new OpenAICompatibleProvider({
            apiKey: config.endpoints[0].api_key,
            model: config.endpoints[0].model,
            baseURL: config.endpoints[0].base_url
          });
          await v.verify();
          console.log('✅ Endpoint valid!');
        } catch (err) {
          console.log(`⚠️  Verifikasi gagal: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('Error:', err.message);
    }
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
