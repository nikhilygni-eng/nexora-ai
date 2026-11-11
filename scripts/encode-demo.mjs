#!/usr/bin/env node
/**
 * Turns the recorder's timestamped JPEG frames (tests/demo/screencast.ts) into a constant
 * 30 fps H.264 MP4 for YouTube:
 *   - page frames (1920×972) on top, a 108 px caption band underneath → 1920×1080
 *   - captions drawn from the recorder's timed caption list, centered, up to two lines
 *   - playback is always 1×. Nothing is ever sped up.
 *
 * If the recording is longer than MAX_SEC (default 176 s; Devpost's limit is under 3:00), the
 * final edit is shortened by cutting, in this order:
 *   1. waiting time (spinners while the AI or PayPal responds), keeping the start and end of each wait
 *   2. scenes the recorder marked optional
 * The uncut recording is kept next to it as nexora-demo-full.mp4. If it still doesn't fit, the
 * script fails rather than rush the video.
 *
 *   node scripts/encode-demo.mjs demo-output
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "demo-output");
const maxSec = Number(process.env.MAX_SEC ?? 176);
const W = 1920;
const PAGE_H = 972;
const BAND_H = 108;
const FONT_SIZE = 30;
const LINE_H = 40;
const MAX_LINE = 82;
const WAIT_KEEP_HEAD = 0.9; // seconds of each wait kept at its start (the loading state stays visible)
const WAIT_KEEP_TAIL = 0.3;

const { endedAt, frames, captions = [], segments = [] } = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
if (!frames.length) throw new Error("No frames recorded");
const t0 = frames[0].t;
const total = endedAt - t0;

function wrap(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length <= MAX_LINE) return [text];
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff && a.length <= MAX_LINE + 6 && b.length <= MAX_LINE + 6) {
      best = i;
      bestDiff = diff;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

function fontFile() {
  const fc = spawnSync("fc-match", ["-f", "%{file}", "DejaVu Sans:bold"], { encoding: "utf8" });
  const f = fc.status === 0 ? fc.stdout.trim() : "";
  return f && fs.existsSync(f) ? f : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}
const font = fontFile();

/** Choose what to cut (absolute recording times) so the edit fits in maxSec. */
function planCuts() {
  let excess = total - maxSec;
  const cuts = [];
  if (excess <= 0) return { cuts, fits: true };
  const take = (a, b) => {
    if (excess <= 0 || b - a < 0.2) return;
    const len = Math.min(b - a, excess + 0.05);
    cuts.push([a, a + len]);
    excess -= len;
  };
  const waits = segments.filter((s) => s.kind === "wait").sort((x, y) => y.b - y.a - (x.b - x.a));
  for (const w of waits) take(w.a + WAIT_KEEP_HEAD, w.b - WAIT_KEEP_TAIL);
  const optional = segments.filter((s) => s.kind === "optional").reverse();
  for (const o of optional) if (excess > 0) { cuts.push([o.a, o.b]); excess -= o.b - o.a; }
  cuts.sort((x, y) => x[0] - y[0]);
  return { cuts, fits: excess <= 0 };
}

function render(cuts, outName, tag) {
  const removedBefore = (t) => cuts.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(t, b) - a), 0);
  const map = (t) => t - t0 - removedBefore(t);

  let concat = "ffconcat version 1.0\n";
  let last = null;
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : endedAt;
    const d = map(next) - map(f.t);
    if (d < 0.001) return;
    concat += `file '${f.file}'\nduration ${d.toFixed(4)}\n`;
    last = f.file;
  });
  concat += `file '${last}'\n`;
  fs.writeFileSync(path.join(dir, `concat_${tag}.txt`), concat);

  const filters = ["fps=30", `scale=${W}:${PAGE_H}:flags=lanczos`, `pad=${W}:${PAGE_H + BAND_H}:0:0:color=0x0f2a44`, `drawbox=x=0:y=${PAGE_H}:w=${W}:h=3:color=0x2442c9:t=fill`];
  const caps = [...captions].sort((a, b) => a.t - b.t);
  let n = 0;
  caps.forEach((c, i) => {
    if (!c.text.trim()) return;
    const start = Math.max(0, map(c.t));
    const end = map(i + 1 < caps.length ? caps[i + 1].t : endedAt);
    if (end - start < 0.05) return;
    const lines = wrap(c.text.trim());
    const top = PAGE_H + 3 + (BAND_H - 3 - lines.length * LINE_H) / 2;
    lines.forEach((line, j) => {
      const file = `cap_${tag}_${n++}.txt`;
      fs.writeFileSync(path.join(dir, file), line);
      filters.push(
        `drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=${FONT_SIZE}:fontcolor=white:` +
          `x=(w-text_w)/2:y=${Math.round(top + j * LINE_H + (LINE_H - FONT_SIZE) / 2)}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`,
      );
    });
  });
  filters.push("format=yuv420p");
  fs.writeFileSync(path.join(dir, `filters_${tag}.txt`), filters.join(",\n"));

  const tmp = `${tag}.partial.mp4`;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `concat_${tag}.txt`, "-filter_script:v", `filters_${tag}.txt`, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp];
  const r = spawnSync("ffmpeg", args, { stdio: "inherit", cwd: dir });
  if (r.status !== 0) process.exit(r.status ?? 1);
  fs.renameSync(path.join(dir, tmp), path.join(dir, outName));
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path.join(dir, outName)], { encoding: "utf8" });
  const sec = Number(probe.stdout);
  console.log(`[encode] wrote ${outName} (${sec.toFixed(1)} s, 1x playback)`);
  return sec;
}

console.log(`[encode] ${frames.length} frames, ${captions.length} captions, ${total.toFixed(1)} s recorded, limit ${maxSec} s`);
const { cuts, fits } = planCuts();
if (!cuts.length) {
  render([], "nexora-demo.mp4", "final");
} else {
  render([], "nexora-demo-full.mp4", "full");
  const cutSec = cuts.reduce((s, [a, b]) => s + (b - a), 0);
  console.log(`[encode] trimming ${cutSec.toFixed(1)} s in ${cuts.length} cut(s): ` + cuts.map(([a, b]) => `${(a - t0).toFixed(1)}–${(b - t0).toFixed(1)}s`).join(", "));
  if (!fits) {
    console.error(`[encode] FAILED: still over ${maxSec} s after trimming every wait and optional scene. Nothing was sped up; the uncut recording is nexora-demo-full.mp4. Shorten the script.`);
    process.exit(1);
  }
  render(cuts, "nexora-demo.mp4", "final");
}
