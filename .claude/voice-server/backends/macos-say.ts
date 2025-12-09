/**
 * macOS Say Backend
 * Uses built-in macOS speech synthesis - zero dependencies
 * Good fallback when other backends unavailable
 */

import { spawn } from "child_process";
import { platform } from "os";
import type { TTSBackend } from "./types";

const IS_MACOS = platform() === "darwin";

// Premium macOS voices (user should download in System Preferences > Accessibility > Spoken Content)
const MACOS_VOICES = ["Samantha", "Alex", "Daniel", "Karen", "Moira", "Tessa", "Veena"];

export class MacOSSayBackend implements TTSBackend {
  readonly name = "macos-say";

  private defaultVoice: string;

  constructor() {
    this.defaultVoice = process.env.MACOS_VOICE || "Samantha";
  }

  isAvailable(): boolean {
    return IS_MACOS;
  }

  getVoices(): string[] {
    return MACOS_VOICES;
  }

  getHealthInfo(): Record<string, unknown> {
    return {
      backend: this.name,
      available: this.isAvailable(),
      defaultVoice: this.defaultVoice,
      platform: platform(),
    };
  }

  async speak(text: string, voiceId?: string): Promise<void> {
    if (!IS_MACOS) {
      throw new Error("macOS say is only available on macOS");
    }

    const voice = voiceId || this.defaultVoice;

    return new Promise((resolve, reject) => {
      const proc = spawn("/usr/bin/say", ["-v", voice, text]);

      proc.on("error", reject);
      proc.on("exit", (code) => {
        code === 0 ? resolve() : reject(new Error(`say exited with code ${code}`));
      });
    });
  }
}

export default MacOSSayBackend;
