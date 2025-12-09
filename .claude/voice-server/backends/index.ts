/**
 * Backend Loader
 * Dynamically loads and selects TTS backends based on config
 */

import type { TTSBackend, VoiceServerConfig } from "./types";
import { ElevenLabsBackend } from "./elevenlabs";
import { PiperBackend } from "./piper";
import { MacOSSayBackend } from "./macos-say";

// Registry of available backends
const BACKENDS: Record<string, new () => TTSBackend> = {
  elevenlabs: ElevenLabsBackend,
  piper: PiperBackend,
  "macos-say": MacOSSayBackend,
};

/**
 * Load first available backend from preference list
 */
export function loadBackend(preferences: string[]): TTSBackend | null {
  for (const name of preferences) {
    const BackendClass = BACKENDS[name];
    if (!BackendClass) {
      console.warn(`Unknown backend: ${name}`);
      continue;
    }

    try {
      const backend = new BackendClass();
      if (backend.isAvailable()) {
        console.log(`Loaded TTS backend: ${name}`);
        return backend;
      }
      console.log(`Backend ${name} not available, trying next...`);
    } catch (e) {
      console.warn(`Failed to load backend ${name}:`, e);
    }
  }

  return null;
}

/**
 * Get all registered backend names
 */
export function getAvailableBackends(): string[] {
  return Object.keys(BACKENDS);
}

/**
 * Check which backends are currently available
 */
export function checkBackendAvailability(): Record<string, boolean> {
  const result: Record<string, boolean> = {};

  for (const [name, BackendClass] of Object.entries(BACKENDS)) {
    try {
      const backend = new BackendClass();
      result[name] = backend.isAvailable();
    } catch {
      result[name] = false;
    }
  }

  return result;
}

export type { TTSBackend, VoiceServerConfig } from "./types";
export { ElevenLabsBackend } from "./elevenlabs";
export { PiperBackend } from "./piper";
export { MacOSSayBackend } from "./macos-say";
