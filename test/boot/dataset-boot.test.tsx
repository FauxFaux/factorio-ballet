// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetBoot } from '../../src/boot/dataset-boot.tsx';
import { packEnvelope } from '../../src/boot/url-envelope.ts';

vi.mock('../../src/dataset/index.ts', () => ({
  createDataset: (id: string, data: unknown) => ({ id, data }),
}));

vi.mock('../../src/dataset/catalogue.ts', () => ({
  legacyDatasetId: 'bobang-r4q',
  isDatasetId: (id: string) => id === 'bobang-r4q',
  datasetCatalogue: {
    'bobang-r4q': { label: "Bob's and Angel's", load: async () => ({ recipes: {} }) },
  },
}));

vi.mock('../../src/boot/url-handler.tsx', () => ({
  UrlHandler: ({ datasetId }: { datasetId: string }) => <div role="main">Plan: {datasetId}</div>,
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('dataset boot', () => {
  it('offers the catalogue when the URL has no state', () => {
    render(<DatasetBoot />);
    expect(screen.getByRole('heading', { name: 'Choose a dataset' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Bob's and Angel's" })).toBeTruthy();
  });

  it('loads the selected dataset and mounts its planner', async () => {
    const user = userEvent.setup();
    render(<DatasetBoot />);
    await user.click(screen.getByRole('button', { name: "Bob's and Angel's" }));
    expect(await screen.findByText('Plan: bobang-r4q')).toBeTruthy();
  });

  it('loads the named dataset directly from a shared URL', async () => {
    const hash = packEnvelope({
      dataset: 'bobang-r4q',
      v: 1,
      cs: '',
      gp: 0,
      cl: [],
      ci: 0,
      mo: {},
    });
    window.history.replaceState({}, '', `/#${hash}`);
    render(<DatasetBoot />);
    expect(await screen.findByText('Plan: bobang-r4q')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Choose a dataset' })).toBeNull();
  });

  it('keeps an unavailable dataset plan intact and offers a fresh start', () => {
    const hash = `#${packEnvelope({
      dataset: 'missing-revision',
      v: 1,
      cs: '',
      gp: 0,
      cl: [{ entries: [{ recipe: 23 }] }],
      ci: 0,
      mo: {},
    })}`;
    window.history.replaceState({}, '', `/${hash}`);
    render(<DatasetBoot />);
    expect(screen.getByRole('heading', { name: 'Unknown dataset' })).toBeTruthy();
    expect(screen.getByText(hash)).toBeTruthy();
    expect(window.location.hash).toBe(hash);
    expect(screen.getByRole('link', { name: 'Choose a fresh dataset' })).toBeTruthy();
  });
});
