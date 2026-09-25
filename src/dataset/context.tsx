import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Dataset } from './index.ts';

const DatasetContext = createContext<Dataset | undefined>(undefined);

export function DatasetProvider({
  value,
  children,
}: {
  value: Dataset;
  children: ComponentChildren;
}) {
  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): Dataset {
  const dataset = useContext(DatasetContext);
  if (dataset === undefined) throw new Error('useDataset must be used inside DatasetProvider');
  return dataset;
}
