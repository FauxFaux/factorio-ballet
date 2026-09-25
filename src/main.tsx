import { render } from 'preact';
import './index.css';
import { UrlHandler } from './boot/url-handler.tsx';
import { DatasetProvider } from './dataset/context.tsx';
import { defaultDataset } from './dataset/index.ts';

render(
  <DatasetProvider value={defaultDataset}>
    <UrlHandler />
  </DatasetProvider>,
  document.getElementById('app')!,
);
