/**
 * Piper TTS Backend
 * Local, offline, free - uses piper-tts neural voices
 * https://github.com/rhasspy/piper
 */

import { spawn, spawnSync } from "child_process";
import { platform, release } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import type { TTSBackend } from "./types";

const IS_MACOS = platform() === "darwin";
const IS_WSL = platform() === "linux" && release().toLowerCase().includes("microsoft");
const IS_LINUX = platform() === "linux";

interface PiperVoice {
  model: string;
  speaker: number;
  description?: string;
}

interface PiperConfig {
  models_dir: string;
  binary: string;
}

interface VoicesConfig {
  tts_engine: string;
  speed: number;
  piper: PiperConfig;
  voices: Record<string, PiperVoice>;
}

export class PiperBackend implements TTSBackend {
  readonly name = "piper";

  private config: VoicesConfig | null = null;
  private piperBinary: string = "";
  private modelsDir: string = "";
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(import.meta.dir, "..");
    this.loadConfig();
  }

  private loadConfig(): void {
    const configPath = join(this.baseDir, "voices.json");
    if (!existsSync(configPath)) {
      console.warn(`Piper: voices.json not found at ${configPath}`);
      return;
    }

    try {
      this.config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (this.config?.piper) {
        this.piperBinary = join(this.baseDir, this.config.piper.binary);
        this.modelsDir = join(this.baseDir, this.config.piper.models_dir);
      }
    } catch (e) {
      console.error("Piper: Failed to load voices.json:", e);
    }
  }

  isAvailable(): boolean {
    return !!this.config && existsSync(this.piperBinary);
  }

  getVoices(): string[] {
    return Object.keys(this.config?.voices || {});
  }

  getHealthInfo(): Record<string, unknown> {
    return {
      backend: this.name,
      available: this.isAvailable(),
      voices: this.getVoices(),
      binaryPath: this.piperBinary,
      modelsDir: this.modelsDir,
    };
  }

  async speak(text: string, voiceId?: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("Piper TTS not available");
    }

    const voice = this.getVoiceConfig(voiceId);
    const pcmData = this.generateSpeech(text, voice);
    const wavData = this.pcmToWav(pcmData);
    await this.playAudio(wavData);
  }

  private getVoiceConfig(voiceId?: string): PiperVoice {
    const voices = this.config?.voices || {};
    if (voiceId && voices[voiceId]) {
      return voices[voiceId];
    }
    return voices.aito || voices.fallback || { model: "en_US-libritts_r-medium", speaker: 0 };
  }

  private generateSpeech(text: string, voice: PiperVoice): Buffer {
    const modelPath = join(this.modelsDir, `${voice.model}.onnx`);

    if (!existsSync(modelPath)) {
      throw new Error(`Piper model not found: ${modelPath}`);
    }

    const args = ["--model", modelPath, "--speaker", voice.speaker.toString(), "--output-raw"];

    const result = spawnSync(this.piperBinary, args, {
      input: text,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      throw new Error(`Piper error: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`Piper failed: ${result.stderr?.toString()}`);
    }

    return result.stdout;
  }

  private pcmToWav(pcmData: Buffer, sampleRate = 22050, channels = 1, bitsPerSample = 16): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;

    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }

  private async playAudio(wavBuffer: Buffer): Promise<void> {
    const tempFile = `/tmp/voice-${Date.now()}.wav`;
    await Bun.write(tempFile, wavBuffer);

    let cmd: string;
    let args: string[];

    if (IS_MACOS) {
      cmd = "/usr/bin/afplay";
      args = [tempFile];
    } else if (IS_WSL) {
      // Play through Windows for WSL
      const winTempFile = `/mnt/c/Users/Public/piper_voice_${Date.now()}.wav`;
      const winPath = winTempFile.replace("/mnt/c", "C:").replace(/\//g, "\\");
      await Bun.write(winTempFile, wavBuffer);

      cmd = "powershell.exe";
      args = ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${winPath}').PlaySync(); Remove-Item '${winPath}'`];
    } else {
      cmd = "aplay";
      args = ["-q", tempFile];
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      proc.on("error", reject);
      proc.on("exit", (code) => {
        spawn("/bin/rm", ["-f", tempFile]);
        code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`));
      });
    });
  }
}

export default PiperBackend;
