#!/usr/bin/env bun
/**
 * PAIVoice - Personal AI Voice Server
 * Pluggable TTS backend architecture
 *
 * Backends (in fallback order from config.json):
 *   - piper: Local neural TTS (free, offline)
 *   - elevenlabs: Cloud TTS (paid, high quality)
 *   - macos-say: macOS native (free, macOS only)
 */

import { serve } from "bun";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadBackend, checkBackendAvailability, type TTSBackend } from "./backends";

// Load .env from home directory
const envPath = join(homedir(), ".env");
if (existsSync(envPath)) {
  const content = await Bun.file(envPath).text();
  content.split("\n").forEach((line) => {
    const [key, ...valueParts] = line.split("=");
    const value = valueParts.join("=");
    if (key && value && !key.startsWith("#")) {
      process.env[key.trim()] = value.trim();
    }
  });
}

// Load config
interface ServerConfig {
  backends: string[];
  defaultVoice?: string;
  server?: { port?: number; rateLimit?: number; rateLimitWindow?: number };
}

let config: ServerConfig = { backends: ["piper", "elevenlabs", "macos-say"] };
const configPath = join(import.meta.dir, "config.json");
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (e) {
    console.warn("Failed to load config.json, using defaults");
  }
}

const PORT = config.server?.port || parseInt(process.env.PORT || "8888");
const RATE_LIMIT = config.server?.rateLimit || 10;
const RATE_WINDOW = config.server?.rateLimitWindow || 60000;

// Load backend
const backend: TTSBackend | null = loadBackend(config.backends);

if (!backend) {
  console.error("No TTS backend available!");
  console.error("Availability:", checkBackendAvailability());
  console.error("Configure one of: piper (local), elevenlabs (API key), macos-say (macOS)");
  process.exit(1);
}

// Sanitize input
function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9\s.,!?\-']/g, "").trim().substring(0, 500);
}

function validateInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== "string") return { valid: false, error: "Invalid input type" };
  if (input.length > 500) return { valid: false, error: "Message too long (max 500)" };
  if (/[;&|><`\$\{\}\[\]\\]/.test(input)) return { valid: false, error: "Invalid characters" };
  return { valid: true };
}

// Voice queue for sequential playback
interface QueueItem {
  message: string;
  voiceId?: string;
}
const voiceQueue: QueueItem[] = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || voiceQueue.length === 0) return;
  isProcessing = true;

  while (voiceQueue.length > 0) {
    const item = voiceQueue.shift()!;
    try {
      await backend!.speak(item.message, item.voiceId);
    } catch (e) {
      console.error("Speech error:", e);
    }
  }

  isProcessing = false;
}

function queueSpeak(message: string, voiceId?: string) {
  voiceQueue.push({ message, voiceId });
  processQueue();
}

// Rate limiting
const rateLimits = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimits.get(ip);
  if (!record || now > record.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT) return false;
  record.count++;
  return true;
}

// HTTP Server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const ip = req.headers.get("x-forwarded-for") || "localhost";

    const cors = {
      "Access-Control-Allow-Origin": "http://localhost",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors, status: 204 });
    }

    if (!checkRateLimit(ip)) {
      return Response.json({ status: "error", message: "Rate limit exceeded" }, { headers: cors, status: 429 });
    }

    // POST /notify - Main notification endpoint
    if (url.pathname === "/notify" && req.method === "POST") {
      try {
        const data = await req.json();
        const message = data.message || "Task completed";
        const voiceEnabled = data.voice_enabled !== false;
        const voiceId = data.voice_id || data.agent || config.defaultVoice;

        const validation = validateInput(message);
        if (!validation.valid) {
          return Response.json({ status: "error", message: validation.error }, { headers: cors, status: 400 });
        }

        console.log(`Notify: "${message}" (voice: ${voiceId || "default"})`);

        if (voiceEnabled) {
          queueSpeak(sanitize(message), voiceId);
        }

        return Response.json({ status: "success", message: "Notification queued" }, { headers: cors });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Internal error";
        return Response.json({ status: "error", message: msg }, { headers: cors, status: 500 });
      }
    }

    // POST /pai - PAI-specific endpoint
    if (url.pathname === "/pai" && req.method === "POST") {
      try {
        const data = await req.json();
        const message = data.message || "Task completed";
        const agent = data.agent || "aito";

        console.log(`PAI: "${message}" (agent: ${agent})`);
        queueSpeak(sanitize(message), agent);

        return Response.json({ status: "success" }, { headers: cors });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Internal error";
        return Response.json({ status: "error", message: msg }, { headers: cors, status: 500 });
      }
    }

    // GET /health - Health check
    if (url.pathname === "/health") {
      return Response.json(
        {
          status: "healthy",
          port: PORT,
          backend: backend.name,
          backends_available: checkBackendAvailability(),
          ...backend.getHealthInfo(),
        },
        { headers: cors }
      );
    }

    return new Response(`PAIVoice Server (${backend.name}) - POST /notify or /pai`, { headers: cors });
  },
});

console.log(`PAIVoice Server on port ${PORT}`);
console.log(`Backend: ${backend.name}`);
console.log(`Voices: ${backend.getVoices().join(", ") || "default"}`);
console.log(`POST http://localhost:${PORT}/notify`);
