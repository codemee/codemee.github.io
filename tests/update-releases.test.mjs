import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repositories, updateReleases, snapshot } from '../scripts/update-releases.mjs';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/releases.json', import.meta.url), 'utf8'));
const oldTime = '2026-11-11T00:00:00Z';
const now = '2026-11-15T00:00:00Z';
const previous = { tools: Object.fromEntries(repositories.map(repo => [repo, { checkedAt: oldTime, release: fixtures[repo] }])) };

test('updater authenticates server-side and saves only public release fields', async () => {
  const requests = [];
  const data = await updateReleases(previous, { now, token: 'test-token', fetcher: async (url, options) => {
    requests.push({url, options});
    const repo = url.split('/')[5];
    return {ok: true, json: async () => ({...fixtures[repo], body: 'ignored', author: {login: 'ignored'}})};
  }});
  assert.equal(requests.length, 8);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
  for (const repo of repositories) {
    assert.equal(data.tools[repo].checkedAt, now);
    assert.deepEqual(data.tools[repo].release, fixtures[repo]);
  }
  assert.ok(!JSON.stringify(data).includes('test-token'));
});

test('one failed or malformed release preserves its old links and check time without stopping other tools', async () => {
  const warnings = [];
  const data = await updateReleases(previous, { now, report: message => warnings.push(message), fetcher: async url => {
    const repo = url.split('/')[5];
    if (repo === 'repdf') return {ok: false, status: 403};
    if (repo === 'mvapp') return {ok: true, json: async () => ({tag_name: 'broken', assets: []})};
    return {ok: true, json: async () => fixtures[repo]};
  }});
  assert.deepEqual(data.tools.repdf, previous.tools.repdf);
  assert.deepEqual(data.tools.mvapp, previous.tools.mvapp);
  assert.equal(data.tools.fshot.checkedAt, now);
  assert.equal(warnings.length, 2);
});

test('updater rejects assets hosted by other owners, repositories, or websites', () => {
  for (const url of ['https://example.com/file.zip', 'https://github.com/other/repdf/releases/download/v1/file.zip', 'https://github.com/codemee/repdf-other/releases/download/v1/file.zip']) {
    assert.throws(() => snapshot('repdf', {tag_name:'v1', assets:[{name:'file.zip', browser_download_url:url}]}));
  }
});
