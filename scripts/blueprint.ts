#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { decodeDocument } from '../src/bp/decode.ts';

async function main() {
  if (process.argv.length !== 3) {
    console.error(`usage: ${process.argv[1]} BLUEPRINT.base64`);
    process.exitCode = 2;
    return;
  }

  const document = decodeDocument(await readFile(process.argv[2], 'utf8'));
  console.log(JSON.stringify(document, null, 2));
}

if (import.meta.main) await main();
