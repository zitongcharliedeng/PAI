/**
 * TTS Backend Interface
 * All voice backends must implement this interface
 */

export interface TTSBackend {
  /** Backend identifier */
  readonly name: string;

  /** Check if backend is available (has deps, API keys, etc) */
  isAvailable(): boolean;

  /** Speak text with optional voice selection */
  speak(text: string, voiceId?: string): Promise<void>;

  /** List available voices for this backend */
  getVoices(): string[];

  /** Health check info for /health endpoint */
  getHealthInfo(): Record<string, unknown>;
}

export interface VoiceServerConfig {
  /** Backend preference order - first available wins */
  backends: string[];

  /** Default voice ID to use */
  defaultVoice?: string;

  /** Per-backend configuration */
  backendConfig?: Record<string, unknown>;
}
