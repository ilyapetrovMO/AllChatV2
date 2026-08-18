import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './app';

describe('desktop renderer bootstrap', () => {
  it('renders the local shell and an empty Instance state', async () => {
    render(
      <App
        bridge={{
          getShellState: async () => ({ instances: [], activeInstanceId: null }),
          addInstance: async () => ({ instances: [], activeInstanceId: null }),
          selectInstance: async () => ({ instances: [], activeInstanceId: null }),
          loginInstance: async () => ({ instances: [], activeInstanceId: null }),
          logoutInstance: async () => ({ instances: [], activeInstanceId: null }),
        }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Add your first Instance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Instance' })).toBeVisible();
  });
});
