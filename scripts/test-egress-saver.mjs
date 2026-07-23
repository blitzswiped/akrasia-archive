import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const player = readFileSync(new URL('../assets/js/player.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../assets/js/core.js', import.meta.url), 'utf8');

assert.match(player, /audio\.preload\s*=\s*['"]metadata['"]/);
assert.doesNotMatch(player, /preloadNextTrack|nextAudioPreload/);
assert.doesNotMatch(core, /nextAudioPreload/);
assert.doesNotMatch(player, /arrayBuffer\s*\(|decodeAudioData\s*\(/);
assert.match(player, /function loadWaveformForAudio[\s\S]*fallbackWaveformPeaks/);

console.log('egress saver contracts passed');
