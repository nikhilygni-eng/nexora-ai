import fs from "node:fs";
import path from "node:path";
import type { CDPSession, Page } from "@playwright/test";

/**
 * Records a page as sharp JPEG frames (quality 92) through Chrome's screencast, with each frame's
 * timestamp, so scripts/encode-demo.mjs can turn them into a constant-30 fps H.264 MP4.
 * Playwright's built-in video is low-bitrate VP8, too soft for reading UI text on YouTube.
 */
export type Recording = {
  caption(text: string): Promise<void>;
  shot(name: string): Promise<void>;
  /** Re-attach after a cross-site navigation (the renderer can change). */
  restart(): Promise<void>;
  stop(): Promise<{ frames: number; seconds: number }>;
};

export async function startRecording(page: Page, outDir: string, size = { width: 1920, height: 1080 }): Promise<Recording> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "frames"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  const frames: { file: string; t: number }[] = [];
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
      await page.evaluate((t) => (window as unknown as { __nxCap?: (s: string) => void }).__nxCap?.(t), text).catch(() => undefined);
    },
    async shot(name: string) {
      await page.screenshot({ path: path.join(outDir, "shots", `${name}.jpg`), type: "jpeg", quality: 92 });
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
      fs.writeFileSync(path.join(outDir, "frames.json"), JSON.stringify({ startedAt, endedAt, frames }, null, 0));
      return { frames: frames.length, seconds: Math.round(endedAt - (frames[0]?.t ?? startedAt)) };
    },
  };
}

/**
 * Injected into every page of the recording: a caption bar and a visible cursor (screen
 * recordings don't show the real one). The caption text survives page loads via sessionStorage.
 */
export const OVERLAY_SCRIPT = `(() => {
  const css = \`
    #nx-demo-cap{position:fixed;left:50%;top:18px;transform:translateX(-50%);max-width:min(1100px,86vw);
      background:rgba(15,42,68,.95);color:#fff;font:600 21px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
      letter-spacing:-.005em;padding:13px 22px;border-radius:12px;box-shadow:0 12px 30px -12px rgba(15,42,68,.55);
      z-index:2147483646;pointer-events:none;text-align:center;opacity:0;transition:opacity .25s ease}
    #nx-demo-cap[data-on="1"]{opacity:1}
    #nx-demo-cursor{position:fixed;left:-13px;top:-13px;width:26px;height:26px;border-radius:50%;
      border:2.5px solid #2442c9;background:rgba(36,66,201,.16);z-index:2147483647;pointer-events:none;
      transition:transform .09s linear, background .15s;opacity:0}
    #nx-demo-cursor[data-on="1"]{opacity:1}
    #nx-demo-cursor[data-down="1"]{background:rgba(36,66,201,.45)}
  \`;
  function ensure(){
    if (!document.body || document.getElementById('nx-demo-cap')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const cap = document.createElement('div'); cap.id = 'nx-demo-cap'; document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = 'nx-demo-cursor'; document.body.appendChild(cur);
    const t = sessionStorage.getItem('nx-cap'); if (t) { cap.textContent = t; cap.dataset.on = '1'; }
    document.addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; cur.dataset.on = '1'; }, true);
    document.addEventListener('mousedown', () => { cur.dataset.down = '1'; setTimeout(() => { delete cur.dataset.down; }, 260); }, true);
  }
  window.__nxCap = (t) => {
    ensure();
    try { sessionStorage.setItem('nx-cap', t || ''); } catch (e) {}
    const cap = document.getElementById('nx-demo-cap'); if (!cap) return;
    cap.textContent = t || ''; cap.dataset.on = t ? '1' : '0';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure); else ensure();
})();`;
