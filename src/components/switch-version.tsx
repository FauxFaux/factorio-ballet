import './switch-version.css';
import { useEffect, useState } from 'preact/hooks';
import * as z from 'zod/mini';
import knownVersionsData from '../assets/known-versions.json';
import { HASH_VERSION } from '../boot/url-handler.tsx';
import { useMenu } from './menu.ts';

const KnownVersion = z.strictObject({
  id: z.string(),
  date: z.string(),
  hash_version: z.string(),
});
const KnownVersionsData = z.strictObject({ versions: z.array(KnownVersion) });
type KnownVersion = z.infer<typeof KnownVersion>;

const fallbackVersions = knownVersionsData.versions;

/** Links to deployed snapshots while preserving the plan currently in the URL hash. */
export function SwitchVersion() {
  const { open, setOpen, box } = useMenu();
  const [versions, setVersions] = useState(fallbackVersions);
  const snapshotId = snapshotIdFromPath(window.location.pathname);
  const currentHashVersion = snapshotId
    ? versions.find((version) => version.id === snapshotId)?.hash_version
    : HASH_VERSION;

  useEffect(() => {
    let cancelled = false;
    void fetch('/known-versions.json')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load version list: ${response.status}`);
        return response.json();
      })
      .then((data: unknown) => {
        const result = KnownVersionsData.safeParse(data);
        if (!cancelled && result.success) setVersions(result.data.versions);
      })
      .catch(() => {
        // The bundled copy keeps the menu useful on preview deployments and offline pages.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const otherVersions = versions.filter((version) => version.id !== snapshotId);

  return (
    <div class="switch-version" ref={box}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch version"
        onClick={() => setOpen(!open)}
      >
        Switch version
      </button>
      {open ? (
        <div class="switch-version-menu" role="menu" aria-label="Switch version">
          {snapshotId ? (
            <a
              href={`/${window.location.hash}`}
              role="menuitem"
              class={
                compatibleHashVersions(currentHashVersion, HASH_VERSION)
                  ? undefined
                  : 'switch-version-incompatible'
              }
            >
              Current version
            </a>
          ) : (
            <span class="switch-version-current" role="menuitem" aria-current="page">
              Current version
            </span>
          )}
          {otherVersions.map((version) => {
            const compatible = compatibleHashVersions(currentHashVersion, version.hash_version);
            return (
              <a
                key={version.id}
                class={compatible ? undefined : 'switch-version-incompatible'}
                href={`/snapshot-${version.id}/${window.location.hash}`}
                role="menuitem"
                title={compatible ? undefined : 'This version cannot read the current URL hash'}
              >
                <time dateTime={version.date}>{formatDate(version.date)}</time>
                <code>{version.id}</code>
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function snapshotIdFromPath(pathname: string): string | undefined {
  return /^\/snapshot-([0-9a-f]+)\/?$/.exec(pathname)?.[1];
}

function compatibleHashVersions(current: string | undefined, candidate: string): boolean {
  return current !== undefined && hashVersionMarker(current) === hashVersionMarker(candidate);
}

function hashVersionMarker(hashVersion: string): string {
  return hashVersion.slice(0, 1);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(date));
}
