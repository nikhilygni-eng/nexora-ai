#!/usr/bin/env node
/**
 * Turns the recorder's timestamped JPEG frames (tests/demo/screencast.ts) into a constant
 * 30 fps H.264 MP4 for YouTube. If the recording runs past MAX_SEC (default 175 s, the Devpost
 * limit is under 3:00), it is sped up evenly to fit.
 *
 *   node scripts/encode-demo.mjs demo-output
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "demo-output");
const maxSec = Number(process.env.MAX_SEC ?? 175);
const { endedAt, frames } = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
if (!frames.length) throw new Error("No frames recorded");

let concat = "ffconcat version 1.0\n";
frames.forEach((f, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : endedAt;
  concat += `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`;
});
concat += `file '${frames[frames.length - 1].file}'\n`;
fs.writeFileSync(path.join(dir, "concat.txt"), concat);

const total = endedAt - frames[0].t;
const speed = total > maxSec ? total / maxSec : 1;
const vf = [speed > 1 ? `setpts=PTS/${speed.toFixed(4)}` : null, "fps=30", "scale=1920:1080:flags=lanczos", "format=yuv420p"].filter(Boolean).join(",");
const tmp = path.join(dir, "nexora-demo.partial.mp4");
const out = path.join(dir, "nexora-demo.mp4");
const args = ["-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "concat.txt"), "-vf", vf, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp];
console.log(`[encode] ${frames.length} frames, ${total.toFixed(1)} s recorded, speed ×${speed.toFixed(2)}`);
const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);
fs.renameSync(tmp, out);
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out], { encoding: "utf8" });
console.log(`[encode] wrote ${out} (${Number(probe.stdout).toFixed(1)} s)`);
