import {MemorySessionVault} from '../src/session/SessionVault';

const firstSession = {
  member: {id: 'member-1', username: 'first', owner: false},
  session_token: 'token-1',
  session_id: 'session-1',
  expires_at: '2030-01-01T00:00:00Z',
};

describe('SessionVault', () => {
  it('keeps separate credentials for multiple Instances', async () => {
    const vault = new MemorySessionVault();
    await vault.put('https://first.example.test', firstSession);
    const accounts = await vault.put('https://second.example.test', {
      ...firstSession,
      member: {...firstSession.member, id: 'member-2', username: 'second'},
      session_token: 'token-2',
      session_id: 'session-2',
    });

    expect(accounts.map(account => account.instance_url)).toEqual([
      'https://second.example.test',
      'https://first.example.test',
    ]);
    expect(accounts[0].session_token).toBe('token-2');
    expect(accounts[1].session_token).toBe('token-1');
  });

  it('replaces credentials for the same Instance', async () => {
    const vault = new MemorySessionVault();
    await vault.put('https://first.example.test', firstSession);
    const accounts = await vault.put('https://first.example.test', {...firstSession, session_token: 'replacement'});

    expect(accounts).toHaveLength(1);
    expect(accounts[0].session_token).toBe('replacement');
  });

  it('removes only the selected Instance', async () => {
    const vault = new MemorySessionVault();
    await vault.put('https://first.example.test', firstSession);
    await vault.put('https://second.example.test', {...firstSession, session_token: 'token-2'});

    const accounts = await vault.remove('https://second.example.test');

    expect(accounts.map(account => account.instance_url)).toEqual(['https://first.example.test']);
  });
});
