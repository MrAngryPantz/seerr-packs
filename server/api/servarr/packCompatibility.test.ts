import { getRequestBatch, withRequestBatch } from '@server/lib/requestBatch';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import RadarrAPI from './radarr';
import SonarrAPI, { type AddSeriesOptions, type SonarrSeries } from './sonarr';

const axiosOf = (api: unknown) => (api as { axios: AxiosInstance }).axios;
const seriesOptions: AddSeriesOptions = {
  tvdbid: 123,
  title: 'Example',
  profileId: 1,
  seasons: [1, 2, 3],
  seasonFolder: true,
  rootFolderPath: '/tv',
  seriesType: 'standard',
  monitored: true,
  searchNow: false,
};

describe('Pack profile compatibility', () => {
  afterEach(() => mock.restoreAll());

  it('accepts upstream profiles without pack fields and never writes profiles', async () => {
    const api = new RadarrAPI({
      url: 'http://localhost/api/v3',
      apiKey: 'test',
    });
    mock.method(api, 'getProfiles', async () => [
      { id: 1, name: 'Normal', upgradeAllowed: true },
    ]);
    const put = mock.method(axiosOf(api), 'put');
    assert.equal(await api.allowsPacks(1, 'movie'), false);
    assert.equal(put.mock.callCount(), 0);
  });

  it('requires upgrades to be explicitly off for either pack type', async () => {
    const api = new SonarrAPI({
      url: 'http://localhost/api/v3',
      apiKey: 'test',
    });
    for (const upgradeAllowed of [true, undefined]) {
      mock.method(api, 'getProfiles', async () => [
        {
          id: 1,
          name: 'Packs',
          allowMultiSeasonPacks: true,
          allowMoviePacks: true,
          upgradeAllowed,
        },
      ]);
      await assert.rejects(api.allowsPacks(1, 'tv'), /upgrades disabled/);
      await assert.rejects(api.allowsPacks(1, 'movie'), /upgrades disabled/);
    }
  });

  for (const allowMultiSeasonPacks of [true, false]) {
    it(`keeps requested seasons monitored on add when packs are ${allowMultiSeasonPacks}`, async () => {
      const api = new SonarrAPI({
        url: 'http://localhost/api/v3',
        apiKey: 'test',
      });
      mock.method(api, 'getProfiles', async () => [
        { id: 1, name: 'Test', allowMultiSeasonPacks, upgradeAllowed: false },
      ]);
      mock.method(axiosOf(api), 'get', async () => ({
        data: [
          {
            seasons: [0, 1, 2, 3, 4].map((seasonNumber) => ({
              seasonNumber,
              monitored: true,
            })),
          },
        ],
      }));
      const post = mock.method(
        axiosOf(api),
        'post',
        async (_path: string, body: Record<string, unknown>) => ({
          data: { ...body, id: 5 },
        })
      );
      await api.addSeries(seriesOptions);
      const body = post.mock.calls[0].arguments[1] as SonarrSeries;
      assert.equal(
        body.addOptions?.ignoreEpisodesWithFiles,
        !allowMultiSeasonPacks
      );
      assert.deepEqual(
        body.seasons
          .filter((s: { monitored: boolean }) => s.monitored)
          .map((s: { seasonNumber: number }) => s.seasonNumber),
        [1, 2, 3]
      );
    });
  }

  it('updates an existing series to the chosen pack profile and monitors only requested episodes', async () => {
    const api = new SonarrAPI({
      url: 'http://localhost/api/v3',
      apiKey: 'test',
    });
    mock.method(api, 'getProfiles', async () => [
      {
        id: 1,
        name: 'Packs',
        allowMultiSeasonPacks: true,
        upgradeAllowed: false,
      },
    ]);
    mock.method(axiosOf(api), 'get', async (path: string) => ({
      data:
        path === '/series/lookup'
          ? [
              {
                id: 5,
                qualityProfileId: 2,
                tags: [],
                seasons: [1, 2, 3, 4].map((seasonNumber) => ({
                  seasonNumber,
                  monitored: false,
                })),
              },
            ]
          : [
              { id: 10, seasonNumber: 1, monitored: false, hasFile: true },
              { id: 11, seasonNumber: 4, monitored: false },
            ],
    }));
    const put = mock.method(
      axiosOf(api),
      'put',
      async (_path: string, body: Record<string, unknown>) => ({
        data: body,
      })
    );
    await api.addSeries(seriesOptions);
    assert.equal(
      (put.mock.calls[0].arguments[1] as SonarrSeries).qualityProfileId,
      1
    );
    assert.deepEqual(put.mock.calls[1].arguments, [
      '/episode/monitor',
      { episodeIds: [10], monitored: true },
    ]);
  });
});

describe('Pack queues', () => {
  afterEach(() => mock.restoreAll());

  it('reads all pages, preserves pack membership and deduplicates overlapping pages', async () => {
    const api = new RadarrAPI({
      url: 'http://localhost/api/v3',
      apiKey: 'test',
    });
    const get = mock.method(
      axiosOf(api),
      'get',
      async (_path: string, options: AxiosRequestConfig) => ({
        data: {
          page: options?.params.page,
          pageSize: 2,
          totalRecords: 5,
          records:
            options?.params.page === 1
              ? [{ id: 1 }, { id: 2 }]
              : options?.params.page === 2
                ? [{ id: 2 }, { id: 3 }]
                : [{ id: 4, moviePackMovieIds: [10, 11] }],
        },
      })
    );
    const queue = await api.getQueue();
    assert.deepEqual(
      queue.map((item) => item.id),
      [1, 2, 3, 4]
    );
    assert.deepEqual(queue[3].moviePackMovieIds, [10, 11]);
    assert.equal(get.mock.callCount(), 3);
    assert.equal(get.mock.calls[0].arguments[1]?.params.includeEpisode, true);
  });

  it('stops safely for an empty queue and a server that ignores pagination', async () => {
    const api = new RadarrAPI({
      url: 'http://localhost/api/v3',
      apiKey: 'test',
    });
    mock.method(axiosOf(api), 'get', async () => ({
      data: { records: [], totalRecords: 0, pageSize: 100 },
    }));
    assert.deepEqual(await api.getQueue(), []);
    mock.method(axiosOf(api), 'get', async () => ({
      data: { records: [{ id: 1 }], totalRecords: 3, pageSize: 1 },
    }));
    await assert.rejects(api.getQueue(), /did not advance/);
  });
});

describe('Isolated request batches', () => {
  it('keeps concurrent users separate and searches after all deliveries finish', async () => {
    const events: string[] = [];
    await Promise.all(
      [1, 2].map((user) =>
        withRequestBatch(async () => {
          const batch = getRequestBatch();
          assert.ok(batch);
          for (const id of [10, 11])
            batch.defer(id, async () => {
              batch.track(
                Promise.resolve().then(() => {
                  events.push(`add ${user} ${id}`);
                  batch.search('server', id, async (ids) => {
                    assert.deepEqual(ids, [10, 11]);
                    assert.ok(events.includes(`add ${user} 11`));
                    events.push(`search ${user}`);
                  });
                })
              );
            });
        })
      )
    );
    assert.deepEqual(events.filter((e) => e.startsWith('search')).sort(), [
      'search 1',
      'search 2',
    ]);
    assert.equal(getRequestBatch(), undefined);
  });
});
