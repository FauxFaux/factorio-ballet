// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { SearchBox } from '../src/components/search-box.tsx';

function SearchBoxExample() {
  const search = useState('');
  return <SearchBox search={search} placeholder="Find a recipe" />;
}

describe('SearchBox', () => {
  it('edits and clears the search through its visible controls', async () => {
    const user = userEvent.setup();
    render(<SearchBoxExample />);

    const search = screen.getByRole('searchbox');
    await user.type(search, 'iron');

    expect(search).toHaveProperty('value', 'iron');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveProperty('value', '');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});
