/**
 * museTalkService.ts
 *
 * Calls the MuseTalk Python service with a WAV audio buffer.
 * Returns an async generator of base64-encoded JPEG frame strings.
 *
 * Gracefully returns nothing (empty generator) when:
 *  - MUSETALK_URL env var is not set
 *  - The service is unreachable
 *  - The audio is too short to synthesize
 *
 * This means the 3D GLB avatar fallback stays active automatically.
 */

const MUSETALK_TIMEOUT_MS = 25_000; // 25s max per sentence

/**
 * Stream JPEG frames from the MuseTalk service for a given audio buffer.
 *
 * @param audioWav   - Raw WAV audio buffer (from Groq TTS or ElevenLabs)
 * @param personaId  - Persona ID matching the photo registered in musetalk_server.py
 * @yields           - base64-encoded JPEG string per frame
 */
export async function* streamMuseTalkFrames(
  audioWav: Buffer,
  personaId: string
): AsyncGenerator<string> {
  const baseUrl = process.env.MUSETALK_URL;
  if (!baseUrl) return; // Feature disabled — 3D avatar used instead

  const url = `${baseUrl.replace(/\/$/, "")}/synthesize`;

  // Build multipart form
  const form = new FormData();
  form.append(
    "audio",
    new Blob([new Uint8Array(audioWav)], { type: "audio/wav" }),
    "audio.wav"
  );
  form.append("persona_id", personaId);
  form.append("fps", "25");

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MUSETALK_TIMEOUT_MS);

    res = await fetch(url, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MuseTalk] Request failed (falling back to 3D avatar): ${msg}`);
    return;
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.warn(`[MuseTalk] Service error ${res.status}: ${body.slice(0, 200)}`);
    return;
  }

  // Parse SSE stream: "data:<base64>\n\n" lines
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let frameCount = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const data = event.replace(/^data:/, "").trim();
        if (!data || data === "__END__") continue;
        frameCount++;
        yield data;
      }
    }
  } catch (err) {
    console.warn(`[MuseTalk] Stream interrupted after ${frameCount} frames:`, err);
  } finally {
    reader.releaseLock();
  }

  console.log(`[MuseTalk] Sent ${frameCount} frames for persona=${personaId}`);
}

/**
 * Quick health check — returns true if the MuseTalk service is reachable.
 * Used by wsHandler to report capabilities to the client.
 */
export async function checkMuseTalkHealth(): Promise<boolean> {
  const baseUrl = process.env.MUSETALK_URL;
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { status?: string };
    return json.status === "ok";
  } catch {
    return false;
  }
}
