export class BaseLLMProvider {
  /**
   * @param {Object} config 
   * @param {string} config.apiKey - API key for the provider.
   * @param {string} config.model - The model to use (e.g. "gpt-4o", "llama3").
   * @param {string} [config.baseURL] - The base URL for the API endpoint (optional if default endpoint is used).
   */
  constructor(config) {
    if (new.target === BaseLLMProvider) {
      throw new TypeError("Cannot construct BaseLLMProvider instances directly");
    }
    
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseURL = config.baseURL ? config.baseURL.replace(/\/$/, "") : null;
  }

  /**
   * Memverifikasi apakah koneksi ke provider valid (opsional)
   * @returns {Promise<boolean>}
   */
  async verify() {
    return true; // Dapat di-override oleh class turunannya
  }

  /**
   * Method utama untuk mengirim pesan ke provider.
   * Wajib diimplementasikan oleh setiap subclass (Ollama, OpenAI, dsb).
   * 
   * @param {Object} params
   * @param {string} params.system - Sistem prompt awal
   * @param {Array} params.messages - Array history pesan [{ role: 'user'|'assistant', content: string, tool_calls: array }]
   * @param {Array} [params.tools] - Tools list yang tersedia
   * @param {Function} [params.onProgress] - Callback jika provider mendukung streaming data
   * @param {string} [params.effort] - Indikator effort ('Low', 'Medium', 'High') untuk mengatur token limits / temperature
   * @returns {Promise<Object>} Mengembalikan objek result dari model 
   *   { 
   *     assistantMessage: { role, content, tool_calls },
   *     toolCalls: [{ id, name, input }],
   *     textOutput: string | null,
   *     usage: { prompt_tokens, completion_tokens, total_tokens }
   *   }
   */
  async send({ system, messages, tools, onProgress, effort = "Medium" }) {
    throw new Error("Method 'send()' must be implemented by subclasses");
  }

  /**
   * Helper untuk mengonversi format pesan balik dari tool-execution
   * agar sesuai dengan standar OpenAI/Generic.
   * Dapat dioverride apabila provider membutuhkan format spesifik (seperti Anthropic).
   * 
   * @param {Object} toolCall - Objek tool call yang dikirimkan oleh model
   * @param {string} outputString - Hasil eksekusi
   * @returns {Object} Message object for the tool result
   */
  buildToolResultMessage(toolCall, outputString) {
    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: outputString,
    };
  }
}
