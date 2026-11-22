// Driver: the harness runs `node main.ts`. It answers every case in
// /input/cases.json with run() from solve.js and writes the answers, one per
// case in the cases' order, to /output/answers.json. Outside a container,
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// The driver keeps its imports to the two modules it needs: every module
// loaded here is loaded inside the timed run, so paths are joined by
// concatenation (a doubled slash is harmless on POSIX) instead of node:path.
import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

// Match the house baseline: V8's incremental marking off, set before
// solve.js loads so the whole parse runs under it.
setFlagsFromString('--no-incremental-marking');

const solver = await import(new URL('./solve.js', import.meta.url).href);
const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(`${inputDir}/cases.json`, 'utf8'));
const out = new Array(cases.length);
for (let i = 0; i < cases.length; i++) out[i] = solver.run(cases[i].input);
writeFileSync(`${outputDir}/answers.json`, JSON.stringify(out));
