import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const repositories = ['fshot', 'repdf', 'rgpdf', 'picview', 'prkit', 'feditor', 'mvapp', 'tubetran'];

export function snapshot(repo, release) {
  if (typeof release?.tag_name !== 'string' || !release.tag_name || !Array.isArray(release.assets) || !release.assets.length) throw Error('Invalid release');
  return {
    tag_name: release.tag_name,
    assets: release.assets.map(({ name, browser_download_url }) => {
      const url = new URL(browser_download_url);
      if (typeof name !== 'string' || url.origin !== 'https://github.com' || !url.pathname.toLowerCase().startsWith(`/codemee/${repo}/releases/download/`)) throw Error('Invalid asset');
      return { name, browser_download_url: url.href };
    })
  };
}

export async function updateReleases(previous, { fetcher = fetch, token, now = new Date().toISOString(), report = console.warn } = {}) {
  const tools = {};
  for (const repo of repositories) {
    const old = previous?.tools?.[repo];
    try {
      const headers = { Accept: 'application/vnd.github+json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetcher(`https://api.github.com/repos/codemee/${repo}/releases/latest`, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      tools[repo] = { checkedAt: now, release: snapshot(repo, await response.json()) };
    } catch (error) {
      // Preserve each tool independently; never replace good links with a failed check.
      if (old) tools[repo] = { checkedAt: old.checkedAt, release: snapshot(repo, old.release) };
      else throw Error(`No previous release available for ${repo}`);
      report(`Could not refresh ${repo}: ${error.message}. Kept previous data.`);
    }
  }
  return { schemaVersion: 1, generatedAt: now, tools };
}

async function main() {
  let previous = JSON.parse(await readFile('releases.json', 'utf8'));
  // The last deployed snapshot contains more recent checks than the tracked seed.
  if (process.env.RELEASES_SOURCE_URL) {
    try {
      const response = await fetch(process.env.RELEASES_SOURCE_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const deployed = await response.json();
      for (const repo of repositories) {
        const entry = deployed.schemaVersion === 1 && deployed.tools?.[repo];
        if (entry && Number.isFinite(Date.parse(entry.checkedAt)) && Date.parse(entry.checkedAt) > Date.parse(previous.tools[repo]?.checkedAt || 0)) {
          previous.tools[repo] = { checkedAt: entry.checkedAt, release: snapshot(repo, entry.release) };
        }
      }
    } catch { console.warn('Previous deployment unavailable; using the bundled snapshot.'); }
  }
  const result = await updateReleases(previous, { token: process.env.GITHUB_TOKEN });
  await writeFile('releases.json', JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
