# Documentation

Start with the [project README](../README.md). Current guidance describes the checked-in implementation; historical reports describe only what was observed at their recorded dates.

| Area | Read |
| --- | --- |
| Development and setup | [Prerequisites, modes, commands and isolated testing](development.md) |
| Architecture | [Frontend, private backend, shared market and local adapters](architecture.md) |
| Features | [Portfolios and notifications](features/portfolios.md), [price history](features/price-history.md), [search catalog maintenance](features/BAZAAR-CATALOG.md) |
| Operating procedures | [Operator entry points and release boundaries](operations/README.md), [notification sender](operations/notifications.md) |
| Artwork | [Sources, regeneration and provenance](../assets/artwork/README.md) |
| Historical releases and incidents | [History index](history/README.md) |
| Audit evidence | [Retained measurements](measurements/README.md), [original item-artwork review](artwork/README.md) |
| Repository maintenance | [Cleanup report and follow-ups](repo-cleanup.md) |

`artwork/catalog-inventory.json` and `bazaar-search-exclusions.json` are inputs to the catalog builder and tests; keep them at their existing paths. Measurement JSON, logs and screenshots linked by historical reports are retained evidence. New disposable output belongs under ignored `.local/`, not in `public/` or documentation.
