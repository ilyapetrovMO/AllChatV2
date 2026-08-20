import { describe, expect, it, vi } from 'vitest';

import { ALLCHAT_APP_USER_MODEL_ID, configureApplicationIdentity } from './application-identity';

describe('desktop application identity', () => {
  it('registers the stable Windows identity required for native notifications', () => {
    const setAppUserModelId = vi.fn();

    configureApplicationIdentity({ setAppUserModelId });

    expect(ALLCHAT_APP_USER_MODEL_ID).toBe('org.allchat.desktop');
    expect(setAppUserModelId).toHaveBeenCalledWith(ALLCHAT_APP_USER_MODEL_ID);
  });
});
