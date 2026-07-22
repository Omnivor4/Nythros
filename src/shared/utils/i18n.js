export const dict = {
  en: {
    apiKeyNotConfigured: 'Endpoint & API Key are not configured.',
    setupGreeting: "Let's setup your AI endpoint configuration.",
    inputBaseUrl: 'Enter Base URL: ',
    inputApiKey: 'Enter your API Key: ',
    inputModel: 'Enter the Model name: ',
    configSaved: 'Configuration saved to ~/.nythros/config.json',

    verifyingEndpoint: 'Verifying Endpoint connection...',
    endpointValid: 'Endpoint verified successfully!',
    endpointError:
      'Failed to connect to Endpoint. Please check your Base URL and API Key using: nythros config set',

    bannerAvailableTools: 'Available Tools',
    bannerAvailableSkills: 'Available Skills',
    bannerNoSkills: '(none — try: nythros skill add <repo-url>)',
    bannerExampleCommand: 'Example Command',
    bannerExample1: 'nythros chat "explain this project structure"',
    bannerExample2: 'nythros config set --obsidian-vault "C:\\path\\vault"',

    replWelcome: "Welcome to Nythros REPL! (Type 'exit' to quit, 'clear' to clear screen)",
    replPrompt: 'You: ',
    replAgentPrefix: 'Nythros: ',
    replThinking: 'Thinking...',
    replCallingTool: 'Calling tool',
  },
  id: {
    apiKeyNotConfigured: 'Endpoint atau API Key belum di-configure.',
    setupGreeting: 'Mari kita setup konfigurasi endpoint AI kamu.',
    inputBaseUrl: 'Masukkan Base URL: ',
    inputApiKey: 'Masukkan API Key kamu: ',
    inputModel: 'Masukkan nama Model AI: ',
    configSaved: 'Konfigurasi tersimpan di ~/.nythros/config.json',

    verifyingEndpoint: 'Memverifikasi koneksi Endpoint...',
    endpointValid: 'Endpoint valid dan terhubung!',
    endpointError:
      'Gagal terhubung ke Endpoint. Cek lagi Base URL dan API Key kamu lewat perintah: nythros config set',

    bannerAvailableTools: 'Alat Tersedia',
    bannerAvailableSkills: 'Skill Tersedia',
    bannerNoSkills: '(belum ada — coba: nythros skill add <repo-url>)',
    bannerExampleCommand: 'Contoh Command',
    bannerExample1: 'nythros chat "jelasin struktur project ini"',
    bannerExample2: 'nythros config set --obsidian-vault "C:\\path\\vault"',

    replWelcome:
      "Selamat datang di Nythros REPL! (Ketik 'exit' untuk keluar, 'clear' untuk hapus layar)",
    replPrompt: 'Kamu: ',
    replAgentPrefix: 'Nythros: ',
    replThinking: 'Mikir...',
    replCallingTool: 'Jalanin tool',
  },
};

export function t(key, lang = 'en') {
  const dictionary = dict[lang] || dict['en'];
  return dictionary[key] || dict['en'][key] || key;
}
