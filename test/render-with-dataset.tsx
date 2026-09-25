import { render as testingRender } from '@testing-library/preact';
import type { ComponentChild, ComponentChildren } from 'preact';
import { DatasetProvider } from '../src/dataset/context.tsx';
import { defaultDataset } from '../src/dataset/index.ts';

function DefaultDataset({ children }: { children: ComponentChildren }) {
  return <DatasetProvider value={defaultDataset}>{children}</DatasetProvider>;
}

export function render(ui: ComponentChild, options?: Parameters<typeof testingRender>[1]) {
  return testingRender(ui, { ...options, wrapper: DefaultDataset });
}
