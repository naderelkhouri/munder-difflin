/**
 * API keys for backend model-providers used by non-Claude CLIs (OpenCode/Crush/pi/qwen).
 * Keys are stored WRITE-ONLY in the encrypted secret broker under `apikey:<backend>`.
 */
export const BACKEND_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY'
};

export const providerKeyRef = (backend: string): string => `apikey:${backend}`;
