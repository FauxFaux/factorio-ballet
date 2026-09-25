import { render } from 'preact';
import './index.css';
import { UrlHandler } from './boot/url-handler.tsx';
import { DatasetProvider } from './dataset/context.tsx';
import { createDataset } from './dataset';
import { staticData } from './data/decode.ts';

render(
  <DatasetProvider value={createDataset('bobang-r4q', staticData)}>
    <UrlHandler data={staticData} />
  </DatasetProvider>,
  document.getElementById('app')!,
);
