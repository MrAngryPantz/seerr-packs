# Seerr Packs

This fork connects collection and season requests to [Sonarr Multi-Season](https://github.com/MrAngryPantz/sonarr-multiseason) and [Radarr Multi-Pack](https://github.com/MrAngryPantz/radarr-multipack).

Seerr is the maintained successor to Overseerr and Jellyseerr. This fork uses Seerr's existing migration support. It does not require a separate Overseerr fork.

## What changes

- Collection requests add the selected, approved movies before starting one combined search per Radarr server. Each film remains a separate request with its own approval, quota usage and availability status. If one addition fails, that server's combined search is held and the failed request can be retried.
- The request form shows when the selected quality profile allows movie or multi-season packs. Seerr never enables packs or changes a quality profile's upgrade settings itself.
- Requested seasons remain monitored when using a pack profile, including episodes that already have files. Other seasons are not added to the request. Existing missing titles can be moved to the selected pack profile, while completed movie files are left alone.
- Download tracking reads every queue page. A shared movie-pack download is shown against each member, and episode-level progress is retained across all requested seasons. A completed download does not mark every member available; the usual library scanners still confirm each film or episode.
- Partial collection failures are shown in the request form. Successful requests are kept, and duplicate submissions do not create extra requests.

Ordinary upstream Sonarr and Radarr installations remain supported. Profiles without pack fields keep their normal behaviour. Pending approvals, blocklists, user permissions, request overrides, 4K destinations and the option to prevent searches continue to apply.

## Set it up

1. In the Sonarr or Radarr fork, enable packs in the quality profile you want to use. Upgrades must be off.
2. In Seerr's service settings, select that quality profile for the appropriate Sonarr or Radarr server.
3. Request several seasons using the usual season selector, or choose the films you want in a collection's **Request Collection** form.
4. Use [Prowlarr Packs](https://github.com/MrAngryPantz/prowlarr-packs) to benefit from its corrected title-search forwarding. Keep the normal indexer connections and seeder settings.

Packs are an allowed download option, not a promise that a pack will be found. All pack members still need to satisfy the Sonarr or Radarr fork's monitoring, metadata and profile rules. Seerr does not request extra films or seasons to make a pack eligible. For a pack containing movies already in Radarr, ensure those members are also monitored and use a pack-enabled profile. Requests awaiting approval are not sent to Radarr until approved.

If a search cannot be started, Seerr reports it while keeping the saved requests. Retry failed requests from the requests page, or start a search in Radarr after resolving the connection problem. After an interrupted batch, check the requests page and Radarr before submitting it again.

## Development and Windows

Use Node.js 22.19 or later in the 22 series and pnpm 10.24.0. Install build prerequisites for SQLite if your platform has no prebuilt module.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/test-startup.mjs
```

The tests cover collection submission, permissions, quotas, approval, duplicate requests, failed additions and searches, old quality profiles, monitored seasons, queue pagination and the existing scanners. They use a disposable database and simulated services. The production trial checks a fresh database, web interface, API schema and authentication without connecting to a real media library. The compatibility workflow runs these checks on Linux and native Windows.

On Windows, run the commands above in PowerShell, then start a separate test installation with:

```powershell
.\scripts\start-windows.ps1 -ConfigDirectory 'C:\Seerr Pack Test\Config' -Port 5056
```

This uses the native Windows Node.js installation. It does not install a service or replace an existing server. The Dockerfile and normal Linux source installation remain available; locally built images should use their own name.

The batch API is `POST /api/v1/request/batch` with a `requests` array of up to 100 ordinary movie request bodies. It returns one result per movie and any search errors. HTTP 207 means some work failed while other requests may have succeeded. Consumers must inspect the results before retrying. API documentation is available at `/api-docs`.

## Migrating

Keep this experimental fork in a separate instance until it has been tested with your configuration. Back up the whole Seerr or Overseerr configuration before migration and follow the [Seerr migration guide](https://docs.seerr.dev/migration-guide/). Existing databases are not modified by the build or test commands above.

Seerr is developed by [the Seerr team](https://github.com/seerr-team/seerr). Upstream history and copyright notices are retained under the [MIT licence](LICENSE).
