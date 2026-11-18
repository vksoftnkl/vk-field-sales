// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { branchesFromOptions, downloadBranches } from './download-branches.ts';

test('every company is read, branches keep VK Nex order and their company', async () => {
  const asked: string[] = [];
  const got = await downloadBranches(['co-a', 'co-b', 'co-c'], async (companyId) => {
    asked.push(companyId);
    if (companyId === 'co-a') return [{ id: 'br-2', name: 'Salem' }, { id: 'br-1', name: ' Head Office ' }];
    if (companyId === 'co-b') return [{ id: 'br-9', name: 'Namakkal' }];
    return [];
  });
  assert.deepEqual(asked, ['co-a', 'co-b', 'co-c']);
  assert.deepEqual(got.rows, [
    { id: 'br-2', companyId: 'co-a', name: 'Salem', position: 1, isDefault: false },
    { id: 'br-1', companyId: 'co-a', name: 'Head Office', position: 2, isDefault: false },
    { id: 'br-9', companyId: 'co-b', name: 'Namakkal', position: 1, isDefault: false },
  ]);
});

test('rows without an id or name, and repeats, are left out', async () => {
  const got = await downloadBranches(['co-a'], async () => [
    { id: '', name: 'No id' },
    { id: 'br-1', name: '  ' },
    { id: 'br-2', name: 'Salem' },
    { id: 'br-2', name: 'Salem again' },
  ]);
  assert.deepEqual(
    got.rows.map((r) => r.id),
    ['br-2'],
  );
});

test('a failed read stops the run', async () => {
  await assert.rejects(
    downloadBranches(['co-a'], async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
});

test('branches sent with the item options: each company keeps VK Nex order and its default', () => {
  const got = branchesFromOptions({
    companies: [{ id: 'co-a' }, { id: 'co-b' }],
    branches: [
      { id: 'br-1', name: 'Counter2', companyId: 'co-a', isDefault: true },
      { id: 'br-2', name: 'Head Office', companyId: 'co-a', isDefault: false },
      { id: 'br-9', name: 'Namakkal', companyId: 'co-b', isDefault: false },
      { id: 'br-x', name: 'Not listed', companyId: 'co-gone', isDefault: false },
      { id: 'br-2', name: 'Repeat', companyId: 'co-a', isDefault: false },
    ],
  });
  assert.deepEqual(got, {
    companyIds: ['co-a', 'co-b'],
    rows: [
      { id: 'br-1', companyId: 'co-a', name: 'Counter2', position: 1, isDefault: true },
      { id: 'br-2', companyId: 'co-a', name: 'Head Office', position: 2, isDefault: false },
      { id: 'br-9', companyId: 'co-b', name: 'Namakkal', position: 1, isDefault: false },
    ],
  });
});

test('an older VK Nex sends no branches with the options: none, so Sync asks per company', () => {
  assert.equal(branchesFromOptions({ companies: [{ id: 'co-a' }] }), null);
  assert.deepEqual(branchesFromOptions({ companies: [{ id: 'co-a' }], branches: [] }), { companyIds: ['co-a'], rows: [] });
});
