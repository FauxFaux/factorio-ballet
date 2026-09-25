import { render } from 'preact';
import './index.css';
import { UrlHandler } from './boot/url-handler.tsx';
import { DatasetProvider } from './dataset/context.tsx';
import { initialDataset } from './boot/initial-dataset.ts';

render(
  <DatasetProvider value={initialDataset}>
    <UrlHandler />
  </DatasetProvider>,
  document.getElementById('app')!,
);
