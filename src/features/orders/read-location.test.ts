// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixOf, readLocation, type LocationApi, type Position } from './read-location.ts';

const pos = (latitude: number, longitude: number, accuracy: number | null, timestamp = Date.UTC(2026, 10, 20, 6, 0)): Position => ({ coords: { latitude, longitude, accuracy }, timestamp });

function fakeApi(over: Partial<LocationApi> = {}): LocationApi & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    getPermission: async () => ({ granted: true, canAskAgain: true }),
    requestPermission: async () => {
      asked.push('permission');
      return { granted: true, canAskAgain: true };
    },
    servicesOn: async () => true,
    lastKnown: async (o) => (o ? null : null),
    current: async () => pos(11.1085, 77.3411, 12.5),
    ...over,
  };
}

test('a visit gets the GPS fix with its accuracy', async () => {
  const r = await readLocation(fakeApi());
  assert.deepEqual(r, { kind: 'fix', fix: { latitude: 11.1085, longitude: 77.3411, accuracyM: 12.5, locatedAt: '2026-11-20T06:00:00.000Z' } });
});

test('permission is asked when it can be; refused for good says so', async () => {
  const api = fakeApi({ getPermission: async () => ({ granted: false, canAskAgain: true }) });
  assert.equal((await readLocation(api)).kind, 'fix');
  assert.deepEqual(api.asked, ['permission']);
  const never = fakeApi({ getPermission: async () => ({ granted: false, canAskAgain: false }) });
  assert.deepEqual(await readLocation(never), { kind: 'denied', canAskAgain: false });
  assert.deepEqual(never.asked, []);
  const no = fakeApi({ getPermission: async () => ({ granted: false, canAskAgain: true }), requestPermission: async () => ({ granted: false, canAskAgain: true }) });
  assert.deepEqual(await readLocation(no), { kind: 'denied', canAskAgain: true });
});

test("location switched off: Android's dialog switches it on, else it says so", async () => {
  let on = false;
  const yes = fakeApi({ servicesOn: async () => on, askToTurnOn: async () => void (on = true) });
  assert.equal((await readLocation(yes)).kind, 'fix');
  const declined = fakeApi({ servicesOn: async () => false, askToTurnOn: async () => Promise.reject(new Error('declined')) });
  assert.deepEqual(await readLocation(declined), { kind: 'off' });
});

test('a recent fix is used at once; no GPS answer falls back to the last known place', async () => {
  const recent = fakeApi({
    lastKnown: async (o) => (o ? pos(11.2, 77.4, 30) : null),
    current: async () => assert.fail('the GPS is not waited for'),
  });
  const r = await readLocation(recent);
  assert.equal(r.kind === 'fix' && r.fix.latitude, 11.2);

  // Indoors: the GPS never answers within the time; the older place is better than none.
  const indoors = fakeApi({ lastKnown: async (o) => (o ? null : pos(11.3, 77.5, 800)), current: () => new Promise(() => {}) });
  const r2 = await readLocation(indoors, 20);
  assert.equal(r2.kind === 'fix' && r2.fix.accuracyM, 800);

  const nothing = fakeApi({ current: async () => Promise.reject(new Error('no fix')) });
  assert.deepEqual(await readLocation(nothing, 20), { kind: 'failed' });
});

test('only real places are kept', () => {
  assert.equal(fixOf(pos(Number.NaN, 77, 5)), null);
  assert.equal(fixOf(pos(91, 77, 5)), null);
  assert.equal(fixOf(null), null);
  assert.equal(fixOf(pos(11, 77, -1))?.accuracyM, null);
});
