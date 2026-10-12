import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { it } from 'node:test';
import downloadTracker from './downloadtracker';
import { getSettings } from './settings';

it('shows a pack against every movie and retains episodes across queue pages', async (t) => {
  const pages: string[] = [];
  const common = {
    size: 1000,
    sizeleft: 500,
    title: 'Example pack',
    downloadId: 'pack',
    status: 'downloading',
    timeleft: '00:05:00',
    estimatedCompletionTime: '2030-01-01T00:00:00Z',
  };
  const server = createServer(async (req, res) => {
    for await (const chunk of req) {
      void chunk;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/command')) {
      res.end('{}');
      return;
    }
    const page = Number(url.searchParams.get('page'));
    const movie = url.pathname.startsWith('/radarr/');
    pages.push(`${movie ? 'movie' : 'tv'}:${page}`);
    const records = movie
      ? page === 1
        ? [
            { ...common, id: 1, movieId: 10, moviePackMovieIds: [10, 11] },
            { ...common, id: 2, movieId: 11, moviePackMovieIds: [10, 11] },
          ]
        : [{ ...common, id: 3, movieId: 12, downloadId: 'ordinary' }]
      : page === 1
        ? [1, 2].map((seasonNumber) => ({
            ...common,
            id: seasonNumber,
            seriesId: 20,
            episodeId: seasonNumber,
            episode: { seasonNumber, episodeNumber: 1, id: seasonNumber },
          }))
        : [
            {
              ...common,
              id: 3,
              seriesId: 20,
              episodeId: 3,
              episode: { seasonNumber: 3, episodeNumber: 1, id: 3 },
            },
          ];
    res.end(JSON.stringify({ page, pageSize: 2, totalRecords: 3, records }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })
  );
  const settings = getSettings();
  const previous = { radarr: settings.radarr, sonarr: settings.sonarr };
  t.after(() => {
    settings.radarr = previous.radarr;
    settings.sonarr = previous.sonarr;
  });
  const connection = {
    id: 0,
    name: 'Local trial',
    hostname: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    apiKey: 'test',
    useSsl: false,
    syncEnabled: true,
  };
  settings.radarr = [
    { ...connection, baseUrl: '/radarr' },
  ] as typeof settings.radarr;
  settings.sonarr = [
    { ...connection, baseUrl: '/sonarr' },
  ] as typeof settings.sonarr;
  await downloadTracker.resetDownloadTracker();
  await downloadTracker.updateDownloads();
  for (const movie of [10, 11, 12]) {
    const progress = downloadTracker.getMovieProgress(0, movie);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].sizeLeft, 500);
  }
  assert.deepEqual(
    downloadTracker
      .getSeriesProgress(0, 20)
      .map((item) => item.episode?.seasonNumber),
    [1, 2, 3]
  );
  assert.deepEqual(pages.sort(), ['movie:1', 'movie:2', 'tv:1', 'tv:2']);
  assert.deepEqual(downloadTracker.getMovieProgress(0, 99), []);
});
