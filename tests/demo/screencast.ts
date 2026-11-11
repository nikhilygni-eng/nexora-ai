import fs from "node:fs";
import path from "node:path";
import type { CDPSession, Page } from "@playwright/test";

/**
 * Records a page as sharp JPEG frames (quality 92) through Chrome's screencast, with each frame's
 * timestamp, so scripts/encode-demo.mjs can turn them into a constant-30 fps H.264 MP4.
 * Playwright's built-in video is low-bitrate VP8, too soft for reading UI text on YouTube.
 * Captions are recorded as timed text and drawn by the encoder in a band below the page,
 * so they never cover the UI (and screenshots stay clean).
 */
export type Recording = {
  caption(text: string): Promise<void>;
  shot(name: string): Promise<void>;
  /**
   * Marks the time spent in `fn` as trimmable in the final edit: "wait" = waiting on the AI or PayPal
   * (the encoder may shorten it, never speed it up), "optional" = a scene that can be dropped if the
   * video would otherwise run past three minutes.
   */
  segment<T>(kind: "wait" | "optional", fn: () => Promise<T>): Promise<T>;
  /** Re-attach after a cross-site navigation (the renderer can change). */
  restart(): Promise<void>;
  stop(): Promise<{ frames: number; seconds: number }>;
};

export async function startRecording(page: Page, outDir: string, size = { width: 1920, height: 972 }): Promise<Recording> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "frames"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  const frames: { file: string; t: number }[] = [];
  const captions: { t: number; text: string }[] = [];
  const segments: { kind: "wait" | "optional"; a: number; b: number }[] = [];
  let n = 0;
  let cdp: CDPSession;
  const startedAt = Date.now() / 1000;

  async function attach() {
    cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const file = `frames/f${String(n++).padStart(6, "0")}.jpg`;
      fs.writeFileSync(path.join(outDir, file), Buffer.from(f.data, "base64"));
      frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
  }
  await attach();

  return {
    async caption(text: string) {
      captions.push({ t: Date.now() / 1000, text });
    },
    async shot(name: string) {
      await page.screenshot({ path: path.join(outDir, "shots", `${name}.jpg`), type: "jpeg", quality: 92 });
    },
    async segment<T>(kind: "wait" | "optional", fn: () => Promise<T>): Promise<T> {
      const a = Date.now() / 1000;
      try {
        return await fn();
      } finally {
        segments.push({ kind, a, b: Date.now() / 1000 });
      }
    },
    async restart() {
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await cdp.detach().catch(() => undefined);
      await attach();
    },
    async stop() {
      await page.waitForTimeout(400);
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      const endedAt = Date.now() / 1000;
      frames.sort((a, b) => a.t - b.t);
      fs.writeFileSync(path.join(outDir, "frames.json"), JSON.stringify({ startedAt, endedAt, frames, captions, segments }, null, 0));
      return { frames: frames.length, seconds: Math.round(endedAt - (frames[0]?.t ?? startedAt)) };
    },
  };
}

/**
 * Rehearsal without a camera: same script, but no frames, screenshots or files are produced.
 * Used to check every click, edit and screen transition against the app before the real recording.
 */
export function startDryRun(): Recording {
  const startedAt = Date.now();
  return {
    async caption() {},
    async shot() {},
    segment: (_kind, fn) => fn(),
    async restart() {},
    async stop() {
      return { frames: 0, seconds: Math.round((Date.now() - startedAt) / 1000) };
    },
  };
}
