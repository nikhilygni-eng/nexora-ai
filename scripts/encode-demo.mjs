#!/usr/bin/env node
/**
 * Turns the recorder's timestamped JPEG frames (tests/demo/screencast.ts) into a constant
 * 30 fps H.264 MP4 for YouTube:
 *   - page frames (1920×972) on top, a 108 px caption band underneath → 1920×1080
 *   - captions drawn from the recorder's timed caption list, centered, up to two lines
 *   - if the recording runs past MAX_SEC (default 175 s; Devpost's limit is under 3:00),
 *     it is sped up evenly to fit, captions included
 *
 *   node scripts/encode-demo.mjs demo-output
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "demo-output");
const maxSec = Number(process.env.MAX_SEC ?? 175);
const W = 1920;
const PAGE_H = 972;
const BAND_H = 108;
const FONT_SIZE = 30;
const LINE_H = 40;
const MAX_LINE = 82;

const { endedAt, frames, captions = [] } = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
if (!frames.length) throw new Error("No frames recorded");
const t0 = frames[0].t;

let concat = "ffconcat version 1.0\n";
frames.forEach((f, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : endedAt;
  concat += `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`;
});
concat += `file '${frames[frames.length - 1].file}'\n`;
fs.writeFileSync(path.join(dir, "concat.txt"), concat);

const total = endedAt - t0;
const speed = total > maxSec ? total / maxSec : 1;

function wrap(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length <= MAX_LINE) return [text];
  // Two balanced lines: break at the space closest to the middle.
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
const filters = [];
if (speed > 1) filters.push(`setpts=PTS/${speed.toFixed(5)}`);
filters.push("fps=30", `scale=${W}:${PAGE_H}:flags=lanczos`, `pad=${W}:${PAGE_H + BAND_H}:0:0:color=0x0f2a44`, `drawbox=x=0:y=${PAGE_H}:w=${W}:h=3:color=0x2442c9:t=fill`);

const caps = captions.map((c) => ({ ...c, t: Math.max(0, c.t - t0) })).sort((a, b) => a.t - b.t);
let n = 0;
caps.forEach((c, i) => {
  if (!c.text.trim()) return;
  const start = c.t / speed;
  const end = (i + 1 < caps.length ? caps[i + 1].t : total) / speed;
  if (end - start < 0.05) return;
  const lines = wrap(c.text.trim());
  const top = PAGE_H + 3 + (BAND_H - 3 - lines.length * LINE_H) / 2;
  lines.forEach((line, j) => {
    const file = `cap_${n++}.txt`;
    fs.writeFileSync(path.join(dir, file), line);
    filters.push(
      `drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=${FONT_SIZE}:fontcolor=white:` +
        `x=(w-text_w)/2:y=${Math.round(top + j * LINE_H + (LINE_H - FONT_SIZE) / 2)}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`,
    );
  });
});
filters.push("format=yuv420p");
fs.writeFileSync(path.join(dir, "filters.txt"), filters.join(",\n"));

const tmp = "nexora-demo.partial.mp4";
const out = "nexora-demo.mp4";
const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-filter_script:v", "filters.txt", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp];
console.log(`[encode] ${frames.length} frames, ${caps.length} captions, ${total.toFixed(1)} s recorded, speed ×${speed.toFixed(2)}`);
const r = spawnSync("ffmpeg", args, { stdio: "inherit", cwd: dir });
if (r.status !== 0) process.exit(r.status ?? 1);
fs.renameSync(path.join(dir, tmp), path.join(dir, out));
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path.join(dir, out)], { encoding: "utf8" });
console.log(`[encode] wrote ${path.join(dir, out)} (${Number(probe.stdout).toFixed(1)} s)`);
