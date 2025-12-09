/**
 * ElevenLabs TTS Backend
 * Cloud-based, high-quality voices (requires API key)
 */

import { spawn } from "child_process";
import { platform } from "os";
import type { TTSBackend } from "./types";

const IS_MACOS = platform() === "darwin";

export class ElevenLabsBackend implements TTSBackend {
  readonly name = "elevenlabs";

  private apiKey: string | undefined;
  private model: string;
  private defaultVoiceId: string;

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    this.model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
    this.defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "s3TPKV1kjDlVtZbl4Ksh";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getVoices(): string[] {
    return [this.defaultVoiceId];
  }

  getHealthInfo(): Record<string, unknown> {
    return {
      backend: this.name,
      model: this.model,
      defaultVoiceId: this.defaultVoiceId,
      apiKeyConfigured: !!this.apiKey,
    };
  }

  async speak(text: string, voiceId?: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error("ElevenLabs API key not configured");
    }

    const voice = voiceId || this.defaultVoiceId;
    const audioBuffer = await this.generateSpeech(text, voice);
    await this.playAudio(audioBuffer);
  }

  private async generateSpeech(text: string, voiceId: string): Promise<ArrayBuffer> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey!,
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        voice_settings: { stability: 0.5, similarity_boost: 0.5 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    return response.arrayBuffer();
  }

  private async playAudio(audioBuffer: ArrayBuffer): Promise<void> {
    const tempFile = `/tmp/voice-${Date.now()}.mp3`;
    await Bun.write(tempFile, audioBuffer);

    return new Promise((resolve, reject) => {
      // Use afplay on macOS, ffplay/mpv on Linux
      const player = IS_MACOS ? "/usr/bin/afplay" : "ffplay";
      const args = IS_MACOS ? [tempFile] : ["-nodisp", "-autoexit", "-loglevel", "quiet", tempFile];

      const proc = spawn(player, args);
      proc.on("error", reject);
      proc.on("exit", (code) => {
        spawn("/bin/rm", ["-f", tempFile]);
        code === 0 ? resolve() : reject(new Error(`Player exited with code ${code}`));
      });
    });
  }
}

export default ElevenLabsBackend;
