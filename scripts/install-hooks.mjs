/**
 * `npm run hooks`: puts the post-commit hook in place, so every commit rebuilds the download zips
 * in the background (see build-downloads.sh). Git keeps hooks out of the repository, so on a fresh
 * clone this is run once.
 */

import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const hook = path.resolve(import.meta.dirname, '..', '.git', 'hooks', 'post-commit');
writeFileSync(hook, '#!/bin/sh\n# Rebuild the download zips in the background after every commit.\nsh scripts/build-downloads.sh\n');
chmodSync(hook, 0o755);
console.log(`post-commit hook installed: ${hook}`);
