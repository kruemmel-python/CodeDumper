#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--import', 'tsx', new URL('./index.ts', import.meta.url).pathname, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
});
process.exit(result.status ?? 1);
