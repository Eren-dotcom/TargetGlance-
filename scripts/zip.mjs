/**
 * Reproducible source archive: the committed tree plus START-HERE.txt, zipped into
 * artifacts/targetglance.zip. Built from `git archive`, so the zip can never contain a file
 * that is not in the repo, and node_modules/dist never sneak in.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolve } from 'node:path';
const out = resolve('artifacts/targetglance.zip');
const work = mkdtempSync(join(tmpdir(), 'targetglance-'));
const root = join(work, 'targetglance');
mkdirSync(root, { recursive: true });

const tar = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { maxBuffer: 1 << 28 });
execFileSync('tar', ['-x', '-C', root], { input: tar });
cpSync('START-HERE.txt', join(root, 'START-HERE.txt'));
mkdirSync('artifacts', { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, 'targetglance', '-x', '*.DS_Store'], { cwd: work });
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out}`);
