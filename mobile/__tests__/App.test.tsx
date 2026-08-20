/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App, {incomingCallModalStatusBarTranslucent} from '../App';
import {MemorySessionVault} from '../src/session/SessionVault';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App vault={new MemorySessionVault()} />);
  });
});

test('positions the incoming Call banner below the system status bar', () => {
  expect(incomingCallModalStatusBarTranslucent).toBe(false);
});
