import { OpenAICompatibleProvider } from "./openaiCompatible.js";

const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRIABLE_MESSAGES = ["timeout", "network error", "fetch failed", 
  "timed out", "econnrefused", "socket hang up", "aborted"];

function isRetriable(err) {
  if (err.status && RETRIABLE_STATUSES.has(err.status)) return true;
  const msg = (err.message || "").toLowerCase();
  return RETRIABLE_MESSAGES.some(m => msg.includes(m));
}

export class FallbackProvider {
  constructor(endpoints) {
    this.providers = endpoints
      .filter(ep => ep.api_key && ep.base_url)
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .map(ep => ({
        id: ep.id || ep.name || "unknown",
        provider: new OpenAICompatibleProvider({
          apiKey: ep.api_key,
          model: ep.model,
          baseURL: ep.base_url,
        }),
        failCount: 0,
        lastFailAt: null,
        cooldownMs: 60000,
      }));

    if (this.providers.length === 0) {
      throw new Error("Belum ada endpoint yang dikonfigurasi. Jalanin: nythros setup");
    }
  }

  async verify() {
    let lastErr = null;
    for (const entry of this.providers) {
      try {
        await entry.provider.verify();
        return; // At least one provider is valid
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`Semua endpoint gagal verifikasi. Error terakhir: ${lastErr?.message}`);
  }

  _availableProviders() {
    const now = Date.now();
    return this.providers.filter(p =>
      p.failCount === 0 ||
      (p.lastFailAt && now - p.lastFailAt > p.cooldownMs)
    );
  }

  async send(params) {
    const available = this._availableProviders();

    if (available.length === 0) {
      const oldest = [...this.providers].sort((a, b) =>
        (a.lastFailAt || 0) - (b.lastFailAt || 0)
      )[0];
      available.push(oldest);
    }

    let lastErr = null;

    for (const entry of available) {
      try {
        const result = await entry.provider.send(params);
        entry.failCount = 0;
        entry.lastFailAt = null;
        return result;
      } catch (err) {
        lastErr = err;

        if (isRetriable(err)) {
          entry.failCount++;
          entry.lastFailAt = Date.now();

          if (params.onProgress) {
            params.onProgress({
              type: "provider_fallback",
              from: entry.id,
              reason: err.message,
              next: available[available.indexOf(entry) + 1]?.id || null
            });
          }

          console.error(
            `[Nythros] Endpoint "${entry.id}" gagal (${err.message}), ` +
            `coba endpoint berikutnya...`
          );
          continue;
        } else {
          throw err;
        }
      }
    }

    throw new Error(
      `Semua endpoint gagal. Error terakhir: ${lastErr?.message}\n` +
      `Cek koneksi internet atau tambahkan endpoint cadangan di config.`
    );
  }

  buildToolResultMessage(toolCall, outputString) {
    return this.providers[0].provider.buildToolResultMessage(toolCall, outputString);
  }

  getStatus() {
    return this.providers.map(p => ({
      id: p.id,
      available: p.failCount === 0 || (Date.now() - (p.lastFailAt || 0)) > p.cooldownMs,
      failCount: p.failCount,
    }));
  }
}

export function createProvider(config, preferredEndpointId = null) {
  const endpoints = config.endpoints || [];

  if (preferredEndpointId) {
    const preferred = endpoints.find(ep => ep.id === preferredEndpointId);
    const rest = endpoints.filter(ep => ep.id !== preferredEndpointId);
    return new FallbackProvider(preferred ? [preferred, ...rest] : endpoints);
  }

  return new FallbackProvider(endpoints);
}
