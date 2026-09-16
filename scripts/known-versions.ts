#!/usr/bin/env node

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SNAPSHOT_ID = /(?:^|\s)snapshot-([0-9a-f]+)\/?\s*$/gim;
const HASH_VERSION = /^(?:export )?const HASH_VERSION = `([^`]+)`;/m;

interface KnownVersion {
  id: string;
  date: string;
  hash_version: string;
}

async function command(command: string, ...args: string[]): Promise<string> {
  return (await execFileAsync(command, args)).stdout.trim();
}

async function git(...args: string[]): Promise<string> {
  return command('git', ...args);
}

async function versionFor(id: string): Promise<KnownVersion | undefined> {
  const commit = await git('rev-parse', '--verify', `${id}^{commit}`);
  let declarations: string;
  try {
    declarations = await git('grep', '-l', 'const HASH_VERSION = ', commit);
  } catch {
    // Snapshots before standard hash versioning have no declaration to record.
    return undefined;
  }
  const declarationFile = declarations.split('\n').find(Boolean)?.replace(`${commit}:`, '');
  if (!declarationFile) return undefined;

  const [date, source] = await Promise.all([
    git('show', '-s', '--format=%aI', commit),
    git('show', `${commit}:${declarationFile}`),
  ]);
  const match = HASH_VERSION.exec(source);
  if (!match) return undefined;

  return { id, date, hash_version: match[1] };
}

async function main() {
  const input = process.argv[2];
  const listing = input
    ? await fs.readFile(input, 'utf8')
    : await command('rsync', 'sek:/srv/ballet.goeswhere.com/');
  const ids = [...listing.matchAll(SNAPSHOT_ID)].map((match) => match[1]!);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0)
    throw new Error(`${input ?? 'rsync listing'}: no snapshot git hashes found`);

  const staticSnapshots = JSON.parse(
    await fs.readFile('scripts/known-static-snapshots.json', 'utf8'),
  ) as { versions: KnownVersion[] };
  const staticVersions = new Map(staticSnapshots.versions.map((version) => [version.id, version]));
  const versions = (
    await Promise.all(uniqueIds.map((id) => staticVersions.get(id) ?? versionFor(id)))
  ).filter((version): version is KnownVersion => version !== undefined);
  versions.sort((a, b) => b.date.localeCompare(a.date));
  await fs.writeFile(
    'src/assets/known-versions.json',
    `${JSON.stringify({ versions }, null, 2)}\n`,
  );
}

await main();
