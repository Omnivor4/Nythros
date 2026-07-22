import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR, ensureHomeDirs } from './utils/paths.js';

const CONFIG_PATH = path.join(HOME_DIR, 'config.json');

const DEFAULT_CONFIG = {
  user: {
    name: 'User',
    language: 'en',
    timezone: 'Asia/Jakarta',
  },
  endpoints: [
    {
      id: 'openai',
      name: 'OpenAI Compatible',
      base_url: '',
      api_key: '',
      model: '',
      supports_vision: true,
      supports_tools: true,
      priority: 1,
    },
    // Contoh endpoint cadangan (uncomment dan isi untuk aktifkan fallback):
    // {
    //   id: "backup-openrouter",
    //   name: "OpenRouter Backup",
    //   base_url: "https://openrouter.ai/api/v1",
    //   api_key: "",
    //   model: "anthropic/claude-haiku",
    //   supports_vision: false,
    //   supports_tools: true,
    //   priority: 2
    // }
  ],
  routing: {
    vision_model: 'openai',
    code_model: 'openai',
    fast_model: 'openai',
    default_model: 'openai',
    eco_mode: false,
  },
  desktop_agent: {
    enabled: true,
    max_steps: 20,
    confidence_threshold: 0.75,
    screenshot_quality: 70,
    screenshot_width: 1280,
    action_delay_ms: 800,
    require_confirmation_for: ['delete', 'send', 'submit', 'sudo'],
  },
  memory: {
    max_session_messages: 50,
    compress_after: 30,
    longterm_max_facts: 200,
  },
  obsidian: {
    vault_path: '',
    enabled: true,
    auto_save_tasks: true,
    search_on_query: true,
  },
  safety: {
    protected_paths: [
      '~/.ssh',
      '~/.gnupg',
      '~/.config/secrets',
      '~/.nythros',
      '.nythros',
      'config.json',
    ],
    require_confirmation: true,
    max_file_ops_per_task: 100,
    sandbox_mode: 'auto',
    docker_image: 'node:20-bookworm-slim',
    docker_network: 'auto',
  },
  theme: {
    accent: 'DCC8A8',
    danger: 'FF6B6B',
    success: '6BCB77',
  },
  budget: {
    session_token_limit: 300000,
  },
  token_budget: {
    max_tokens_per_session: 50000,
    warn_at_percent: 80,
    enabled: true,
  },
  notion: {
    api_key: '',
    gdd_page_id: '',
  },
  mcpServers: [],
};

function deepMerge(target, source) {
  // Bug 26: DeepMerge nested array bug
  if (Array.isArray(target) && Array.isArray(source)) {
    const output = [...target];
    source.forEach((item, index) => {
      if (typeof output[index] === 'undefined') {
        output[index] = item;
      } else if (isObject(item) && isObject(output[index])) {
        output[index] = deepMerge(output[index], item);
      } else if (Array.isArray(item) && Array.isArray(output[index])) {
        output[index] = deepMerge(output[index], item);
      } else {
        output[index] = item;
      }
    });
    return output;
  }

  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else if (Array.isArray(source[key]) && Array.isArray(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    });
  }
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

function readRawConfigOrEmpty() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function loadConfig() {
  ensureHomeDirs();
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const saved = JSON.parse(raw);
    return deepMerge(DEFAULT_CONFIG, saved);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Mutex sederhana untuk mencegah race condition saat multiple save
let configLock = Promise.resolve();

async function withConfigLock(fn) {
  const currentLock = configLock;
  let release;
  configLock = new Promise((resolve) => {
    release = resolve;
  });
  await currentLock;
  try {
    return await fn();
  } finally {
    if (release) release();
  }
}

export function saveConfig(newConfig) {
  const cfgPath = CONFIG_PATH;
  const current = readRawConfigOrEmpty();

  // To ensure newConfig gets default fields if they are missing in current,
  // we first merge DEFAULT_CONFIG with current, then with newConfig
  const withDefaults = deepMerge(DEFAULT_CONFIG, current);
  const merged = deepMerge(withDefaults, newConfig);

  // Filter out deprecated keys
  const cleanConfig = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (k in merged) cleanConfig[k] = merged[k];
  }

  fs.writeFileSync(cfgPath, JSON.stringify(cleanConfig, null, 2), 'utf8');
  try {
    fs.chmodSync(cfgPath, 0o600);
  } catch {
    // Ignore error on Windows
  }
  return merged;
}

// Async version untuk dipanggil dari concurrent context
export async function saveConfigAsync(newConfig) {
  return withConfigLock(() => {
    return Promise.resolve(saveConfig(newConfig));
  });
}

export { CONFIG_PATH };
