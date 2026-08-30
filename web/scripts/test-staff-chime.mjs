import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const assetUrl = new URL(
  "../public/sounds/new-guest-alert.wav",
  import.meta.url,
);
const staffPage = readFileSync(
  new URL("../src/app/staff/page.tsx", import.meta.url),
  "utf8",
);
const wav = readFileSync(assetUrl);

assert.equal(wav.toString("ascii", 0, 4), "RIFF", "chime must be RIFF WAV");
assert.equal(wav.toString("ascii", 8, 12), "WAVE", "chime must be WAVE audio");

const chunks = new Map();
for (let offset = 12; offset + 8 <= wav.length; ) {
  const id = wav.toString("ascii", offset, offset + 4);
  const size = wav.readUInt32LE(offset + 4);
  const dataStart = offset + 8;
  const dataEnd = dataStart + size;
  assert.ok(dataEnd <= wav.length, `${id} chunk exceeds WAV length`);
  chunks.set(id, wav.subarray(dataStart, dataEnd));
  offset = dataEnd + (size % 2);
}

const format = chunks.get("fmt ");
const samples = chunks.get("data");
assert.ok(format, "chime must include a format chunk");
assert.ok(samples, "chime must include sample data");

const audioFormat = format.readUInt16LE(0);
const channels = format.readUInt16LE(2);
const sampleRate = format.readUInt32LE(4);
const bitsPerSample = format.readUInt16LE(14);
assert.equal(audioFormat, 1, "chime must use uncompressed PCM");
assert.equal(channels, 1, "chime should stay mono for compact playback");
assert.equal(sampleRate, 44_100, "chime should use 44.1 kHz audio");
assert.equal(bitsPerSample, 16, "chime should use 16-bit samples");

const sampleCount = samples.length / 2;
const durationSeconds = sampleCount / sampleRate;
let peak = 0;
let sumSquares = 0;
for (let offset = 0; offset < samples.length; offset += 2) {
  const normalized = samples.readInt16LE(offset) / 32_768;
  peak = Math.max(peak, Math.abs(normalized));
  sumSquares += normalized * normalized;
}
const rms = Math.sqrt(sumSquares / sampleCount);

assert.ok(
  durationSeconds >= 1.2 && durationSeconds <= 1.5,
  `arrival chime should be a clear two-pulse alert; got ${durationSeconds.toFixed(2)}s`,
);
assert.ok(
  peak >= 0.85 && peak <= 1,
  `arrival chime should peak near full volume without clipping; got ${peak.toFixed(3)}`,
);
assert.ok(
  rms >= 0.2,
  `arrival chime should have enough sustained energy for a noisy venue; got ${rms.toFixed(3)}`,
);

assert.match(
  staffPage,
  /const STAFF_CHIME_PATH = "\/sounds\/new-guest-alert\.wav";/,
  "staff dashboard should use the cache-busted loud chime",
);
assert.match(
  staffPage,
  /const audio = new Audio\(STAFF_CHIME_PATH\);\s+audio\.volume = 1;/,
  "staff dashboard should request full browser playback volume",
);
assert.match(
  staffPage,
  /if \(knownIdsRef\.current === null\) \{\s+knownIdsRef\.current = nextIds;\s+return;/,
  "initial queue load must not trigger the chime",
);
assert.match(
  staffPage,
  /const \[soundReady, setSoundReady\] = useState\(false\);/,
  "saved preference must be separate from verified browser sound readiness",
);
assert.match(
  staffPage,
  /await audio\.play\(\);\s+setSoundReady\(true\);\s+setSoundError\(null\);/,
  "sound should become ready only after browser playback starts",
);
assert.match(
  staffPage,
  /catch \(error\) \{\s+setSoundReady\(false\);\s+setSoundError\(/,
  "blocked playback should create a visible failure state",
);
assert.match(
  staffPage,
  /Enable &amp; test sound/,
  "staff should have an explicit user-gesture sound unlock control",
);
assert.match(
  staffPage,
  /if \(!hasNew \|\| !soundOn \|\| !soundReady\) return;/,
  "arrival playback must require a new entry and verified sound readiness",
);
assert.match(
  staffPage,
  /const seenIds = knownIdsRef\.current;[\s\S]*?if \(!seenIds\.has\(id\)\) \{\s+seenIds\.add\(id\);\s+hasNew = true;/,
  "seen guest IDs should remain remembered across temporary queue flicker",
);
assert.doesNotMatch(
  staffPage,
  /setSoundOn\(\(prev\) =>[\s\S]*?audio\.play\(\)/,
  "browser playback must not run inside a React state updater",
);

console.log(
  `Staff chime checks passed (${durationSeconds.toFixed(2)}s, peak ${peak.toFixed(3)}, RMS ${rms.toFixed(3)}).`,
);
