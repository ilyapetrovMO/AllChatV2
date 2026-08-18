import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './app';

describe('desktop renderer bootstrap', () => {
  it('renders the local shell and an empty Instance state', async () => {
    render(
      <App
        bridge={{
          getShellState: async () => ({ instances: [], activeInstanceId: null }),
          addInstance: async () => undefined,
          selectInstance: async () => undefined,
        }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Add your first Instance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Instance' })).toBeVisible();
  });
});
