import { AsyncLocalStorage } from 'node:async_hooks';

type Search = {
  movieIds: Set<number>;
  run: (movieIds: number[]) => Promise<void>;
};

// Each HTTP request owns its batch. Other users and ordinary requests never
// inherit its deferred searches, even when they run at the same time.
class RequestBatch {
  private collecting = true;
  private deliveries = new Map<number, () => Promise<void>>();
  private pending: Promise<unknown>[] = [];
  private searches = new Map<string, Search>();
  private failedServers = new Set<string>();
  private aborted = false;
  public searchErrors: string[] = [];

  public defer(id: number, delivery: () => Promise<void>): boolean {
    if (!this.collecting) return false;
    this.deliveries.set(id, delivery);
    return true;
  }

  public track(delivery: Promise<unknown>): void {
    this.pending.push(delivery);
  }

  public search(server: string, movieId: number, run: Search['run']): void {
    const search = this.searches.get(server) ?? {
      movieIds: new Set<number>(),
      run,
    };
    search.movieIds.add(movieId);
    this.searches.set(server, search);
  }

  public fail(server: string): void {
    this.failedServers.add(server);
  }

  public abort(): void {
    this.aborted = true;
  }

  public async flush(): Promise<void> {
    this.collecting = false;
    for (const delivery of this.deliveries.values()) {
      await delivery();
      // A subscriber normally starts its delivery in the background. Wait
      // for it outside the database transaction before starting the next.
      await Promise.all(this.pending.splice(0));
    }

    for (const [server, search] of this.searches) {
      if (this.aborted || this.failedServers.has(server)) {
        this.searchErrors.push(
          'A movie could not be added. Retry the failed request before searching this collection.'
        );
        continue;
      }
      try {
        await search.run([...search.movieIds]);
      } catch {
        this.searchErrors.push(
          'Movies were added, but the search could not be started. Start a search in Radarr.'
        );
      }
    }
  }
}

const storage = new AsyncLocalStorage<RequestBatch>();
export const getRequestBatch = () => storage.getStore();

export async function withRequestBatch<T>(
  create: () => Promise<T>
): Promise<{ result: T; searchErrors: string[] }> {
  const batch = new RequestBatch();
  return storage.run(batch, async () => {
    try {
      const result = await create();
      return { result, searchErrors: batch.searchErrors };
    } finally {
      await batch.flush();
    }
  });
}
