import './dataset-boot.css';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import type { StaticData } from '../types.ts';
import { createDataset, type Dataset } from '../dataset/index.ts';
import { DatasetProvider } from '../dataset/context.tsx';
import { datasetCatalogue, isDatasetId, legacyDatasetId } from '../dataset/catalogue.ts';
import { parseEnvelope, type EnvelopeResult } from './url-envelope.ts';

type UrlHandlerComponent = ComponentType<{ data: StaticData; datasetId: string }>;
type Loaded = { id: string; dataset: Dataset; UrlHandler: UrlHandlerComponent };

function targetFor(envelope: EnvelopeResult): string | undefined {
  return envelope.kind === 'ok' ? (envelope.packed.dataset ?? legacyDatasetId) : undefined;
}

export function DatasetBoot() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [selected, setSelected] = useState<string>();
  const [loaded, setLoaded] = useState<Loaded>();
  const [loadError, setLoadError] = useState<string>();
  const envelope = parseEnvelope(hash);
  const id = targetFor(envelope) ?? selected;

  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash);
      setSelected(undefined);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!id || !isDatasetId(id)) return;
    let cancelled = false;
    Promise.all([datasetCatalogue[id].load(), import('./url-handler.tsx')])
      .then(([data, module]) => {
        if (!cancelled) {
          setLoaded({ id, dataset: createDataset(id, data), UrlHandler: module.UrlHandler });
          setLoadError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (envelope.kind === 'version-error') {
    return (
      <Recovery title="Unrecognised URL" message="The URL has no recognised version prefix." />
    );
  }
  if (envelope.kind === 'unpack-error') {
    return <Recovery title="Corrupt URL state" message={envelope.message} hash={envelope.hash} />;
  }
  if (id && !isDatasetId(id)) {
    return (
      <Recovery
        title="Unknown dataset"
        message={`This plan needs dataset ${id}, which is unavailable.`}
        hash={hash}
      />
    );
  }
  if (!id) {
    return (
      <main class="dataset-boot">
        <h1>Choose a dataset</h1>
        <p>Choose the Factorio data for a new plan.</p>
        <ul>
          {Object.entries(datasetCatalogue).map(([datasetId, entry]) => (
            <li key={datasetId}>
              <button type="button" onClick={() => setSelected(datasetId)}>
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  if (loadError) return <Recovery title="Dataset unavailable" message={loadError} hash={hash} />;
  if (!loaded || loaded.id !== id)
    return (
      <main class="dataset-boot" role="status">
        Loading dataset…
      </main>
    );

  const { dataset, UrlHandler } = loaded;
  return (
    <DatasetProvider key={dataset.id} value={dataset}>
      <UrlHandler data={dataset.data} datasetId={dataset.id} />
    </DatasetProvider>
  );
}

function Recovery({ title, message, hash }: { title: string; message: string; hash?: string }) {
  return (
    <main class="dataset-boot">
      <h1>{title}</h1>
      <p>{message}</p>
      {hash && <pre>{hash}</pre>}
      <p>
        <a href={window.location.pathname}>Choose a fresh dataset</a>
      </p>
    </main>
  );
}
