import type { Locator, Page } from "@playwright/test";

/**
 * Makes the demo recording look like a person calmly using the app: an arrow pointer that glides
 * to each control and pauses before clicking, typing at about 60 words per minute with uneven
 * rhythm, and visible select-then-replace edits. Everything runs in real time (1× playback).
 * Recording helpers only; the app is not modified.
 */
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class Human {
  private x = 820;
  private y = 420;

  constructor(private readonly page: Page) {}

  pause(ms: number) {
    return this.page.waitForTimeout(ms);
  }

  /** Nudge the pointer so the arrow is drawn again after a page load. */
  async wake() {
    await this.page.mouse.move(this.x + 1, this.y + 1);
    await this.page.mouse.move(this.x, this.y);
  }

  /** Glide along a slightly curved path with ease-in-out, like a hand on a mouse. */
  async moveTo(x: number, y: number) {
    const sx = this.x;
    const sy = this.y;
    const dist = Math.hypot(x - sx, y - sy);
    if (dist < 2) return;
    const duration = Math.min(950, Math.max(320, dist * 0.95));
    const steps = Math.max(10, Math.round(duration / 20));
    const bow = Math.min(36, dist * 0.07) * (Math.random() < 0.5 ? -1 : 1);
    const nx = -(y - sy) / dist;
    const ny = (x - sx) / dist;
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const arc = Math.sin(Math.PI * t) * bow;
      await this.page.mouse.move(sx + (x - sx) * e + nx * arc, sy + (y - sy) * e + ny * arc);
      const wait = t0 + duration * t - Date.now();
      if (wait > 1) await this.page.waitForTimeout(wait);
    }
    this.x = x;
    this.y = y;
  }

  /** Smooth-scroll a result into the middle of the screen so viewers can read it. */
  async reveal(target: Locator) {
    await target.waitFor({ state: "visible", timeout: 30_000 });
    await target.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await this.settle(target);
  }

  private async settle(target: Locator) {
    let prev = await target.boundingBox();
    for (let i = 0; i < 16; i++) {
      await this.page.waitForTimeout(120);
      const now = await target.boundingBox();
      if (prev && now && Math.abs(now.y - prev.y) < 0.5 && Math.abs(now.x - prev.x) < 0.5) return;
      prev = now;
    }
  }

  /** Move the pointer onto a control and rest there briefly. */
  async pointAt(target: Locator, dwellMs = rand(260, 420)) {
    await target.waitFor({ state: "visible", timeout: 30_000 });
    const vp = this.page.viewportSize() ?? { width: 1600, height: 810 };
    let box = await target.boundingBox();
    if (!box || box.y < 16 || box.y + box.height > vp.height - 16) {
      await this.reveal(target);
      box = await target.boundingBox();
    }
    if (!box) throw new Error("Demo recorder: control has no position on screen");
    await this.moveTo(box.x + box.width / 2 + rand(-3, 3), box.y + box.height / 2 + rand(-2, 2));
    await this.page.waitForTimeout(dwellMs);
  }

  /** A real mouse click on a visible, enabled control (same checks as Playwright's click). */
  async click(target: Locator, opts: { dwellMs?: number } = {}) {
    await target.waitFor({ state: "visible", timeout: 30_000 });
    await target.click({ trial: true, timeout: 30_000 });
    await this.pointAt(target, opts.dwellMs);
    await this.page.mouse.down();
    await this.page.waitForTimeout(rand(60, 100));
    await this.page.mouse.up();
    await this.page.waitForTimeout(rand(160, 260));
  }

  private async keys(text: string) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      let delay = rand(115, 205);
      if (ch === " ") delay += rand(30, 90);
      if (ch === "," || ch === ".") delay += rand(200, 340);
      if (Math.random() < 0.03) delay += rand(180, 320);
      await this.page.waitForTimeout(delay);
    }
  }

  /** Click the field so it visibly takes focus, then type. */
  async type(field: Locator, text: string) {
    await this.click(field);
    await this.page.waitForTimeout(rand(250, 400));
    await this.keys(text);
  }

  /** Click the field, select what's there (the selection is visible), then type over it. */
  async replace(field: Locator, text: string) {
    await this.click(field);
    await this.page.waitForTimeout(rand(200, 300));
    await this.page.keyboard.press("ControlOrMeta+A");
    await this.page.waitForTimeout(rand(420, 560));
    if (text) await this.keys(text);
    else await this.page.keyboard.press("Backspace");
  }
}

/**
 * Injected into every page of the recording: an arrow pointer that follows the mouse (screen
 * recordings don't show the real one) and a soft ring on each click. Built with DOM APIs and
 * element styles only, so it also works on pages with a strict content-security policy.
 */
export const CURSOR_SCRIPT = `(() => {
  if (window.__nxCursor) return;
  window.__nxCursor = true;
  var NS = 'http://www.w3.org/2000/svg';
  var cur = null;
  function ensure() {
    if (cur && cur.isConnected) return cur;
    var host = document.body || document.documentElement;
    if (!host) return null;
    cur = document.createElementNS(NS, 'svg');
    cur.setAttribute('viewBox', '0 0 24 24');
    var s = cur.style;
    s.position = 'fixed'; s.left = '0'; s.top = '0'; s.width = '22px'; s.height = '22px';
    s.zIndex = '2147483647'; s.pointerEvents = 'none'; s.opacity = '0';
    s.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,.35))';
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M3 2 L3 19 L7.6 14.9 L10.6 21.5 L13.4 20.3 L10.5 13.8 L16.8 13.8 Z');
    p.setAttribute('fill', '#0f172a');
    p.setAttribute('stroke', '#ffffff');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linejoin', 'round');
    cur.appendChild(p);
    host.appendChild(cur);
    return cur;
  }
  document.addEventListener('mousemove', function (e) {
    var c = ensure();
    if (!c) return;
    c.style.transform = 'translate(' + (e.clientX - 2.75) + 'px,' + (e.clientY - 1.8) + 'px)';
    c.style.opacity = '1';
  }, true);
  document.addEventListener('mousedown', function (e) {
    var host = document.body || document.documentElement;
    if (!host) return;
    var r = document.createElement('div');
    var s = r.style;
    s.position = 'fixed'; s.left = (e.clientX - 15) + 'px'; s.top = (e.clientY - 15) + 'px';
    s.width = '30px'; s.height = '30px'; s.borderRadius = '50%'; s.boxSizing = 'border-box';
    s.border = '2px solid rgba(36,66,201,.75)'; s.background = 'rgba(36,66,201,.12)';
    s.zIndex = '2147483646'; s.pointerEvents = 'none';
    host.appendChild(r);
    if (r.animate) r.animate([{ transform: 'scale(.35)', opacity: 0.95 }, { transform: 'scale(1.2)', opacity: 0 }], { duration: 430, easing: 'ease-out' });
    setTimeout(function () { r.remove(); }, 420);
  }, true);
})();`;
