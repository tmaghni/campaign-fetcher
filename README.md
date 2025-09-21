# reddit-scraper

## Purpose

A small TypeScript system to fetch posts from sources (currently Reddit via a global `reddit` CLI), store canonical posts in MongoDB, and allow independent "campaigns" to classify and tag posts. Campaign definitions live under `reference/campaigns` and include both human-facing qualifiers and machine-friendly criteria as well as fetcher configuration.

## Goals

-  Ingest posts from multiple sources (reddit, hn, etc.).
-  Store canonical post documents in source-specific collections (e.g., `reddit`, `hn`).
-  Enable multiple campaigns to independently tag posts via a classifier microservice.
-  Provide a manifest-driven fetcher configuration (campaigns include `fetcher` blocks that control polling, paging, and source-specific options).

## Repository layout

-  reference/
   -  campaigns/ -- campaign manifest JSON files (e.g. `ai-engineer.json`)
   -  README_CAMPAIGNS.md -- campaign reference doc
-  src/
   -  fetchers/ -- fetcher interfaces and implementations
   -  manifest/ -- manifest loader

## Key concepts

-  Canonical posts: stored per source in a collection named by `sourceTable` (e.g., `reddit`). `_id` is the source post id.
-  Campaigns: definitions that include labels, criteria, thresholds and fetcher config.
-  Campaign tags: stored in `campaign_tags` collection as documents referencing `postId` and `campaignId`.

## Campaign manifest (example)

See `reference/campaigns/ai-engineer.json` for a complete example. Manifests include:

-  id, name, objective, qualifier
-  criteria: { keywords, patterns, heuristics, examples }
-  labels: array of label definitions
-  thresholds: numeric thresholds for confidence-based mapping
-  classifierHints: optional instructions for the classifier
-  fetcher: { fetcherType, sourceTable, mode, pollIntervalSeconds, limit, max, perPage, options }

## Fetcher configuration (current conventions)

The project uses a manifest-driven fetcher system. A campaign manifest's `fetcher` field may be a single fetcher object or an array of fetcher objects. Each fetcher controls how the program retrieves data from a source (for example, Reddit via a CLI tool).

Fetcher config fields you should know (implemented / respected by fetcher runtime):

-  `fetcherType` (string) — maps to a constructor in `src/fetchers/registry.ts`.
-  `sourceTable` (string) — MongoDB collection name where canonical posts are stored (e.g., `reddit`).
-  `mode` (`poll` | `one-shot`) — whether the fetcher runs repeatedly or only once.
-  `pollIntervalSeconds` (number) — base interval between poll runs (seconds).
-  `startDelaySeconds` (number) — optional delay before the first run (seconds). Useful to stagger fetchers across campaigns and reduce bursts.
-  `startImmediately` (bool) — if false, the first execution is scheduled after `pollIntervalSeconds`.
-  `perPage`, `limit`, `max` — pagination controls used by source-specific fetchers.
-  `enabled` (bool) — whether this fetcher should be started.

## CLI invocation contract (standardized)

The preferred shape for fetcher CLI configuration is a `cli` property describing one or more invocations, where each invocation is an object with `program` and `args`:

{
"cli": { "program": "reddit", "args": ["list", "--subreddit", "forhire", "--sort", "new"] }
}

Or an array:

{
"cli": [
{ "program": "reddit", "args": [...] },
{ "program": "reddit", "args": [...] }
]
}

Backward compatibility: legacy shapes are still accepted (for now):

-  `cli` as string[] (single invocation) with `cliBinary` specifying the program.
-  `cli` as string[][] (array of invocations) with `cliBinary`.

Runtime normalization: `src/fetchers/redditCliFetcher.ts` normalizes all accepted shapes into an array of { program, args } and executes each via `execa(program, args)`.

## How to add a new fetcher (for model or implementer)

1. Implement a class that extends `BaseFetcher` (see `src/fetchers/baseFetcher.ts`). The class should implement at minimum:

   -  constructor(config: FetcherConfig)
   -  async start(): Promise<void>
   -  async stop(): Promise<void>
   -  async fetchOnce(): Promise<void>

2. Register the fetcher in `src/fetchers/registry.ts` with a unique `fetcherType` string. The registry maps `fetcherType` to a factory/constructor used by `src/index.ts`.

3. Fetcher responsibilities and conventions:

   -  Use `this.config.sourceTable` to determine where to persist canonical posts.
   -  Persist posts by calling into the `store` module (e.g., `store.bulkUpsertPosts(collectionName, posts)`). Posts should include an `id` field; the store maps that to `_id`.
   -  Use `startDelaySeconds` to stagger initial run; the base poll loop should honor `pollIntervalSeconds` for subsequent runs.
   -  Be conservative with concurrency; prefer sequential CLI calls within a single fetcher unless higher performance is necessary and safe.
   -  Implement graceful error handling: parse errors, CLI process failures, or persistence errors should be logged but should not crash the process.

4. Add tests: create unit tests that mock the external CLI (mock `execa`) and mock the `store` to assert calls and error handling. Integration tests that use `mongodb-memory-server` are useful but may require host libraries (see Test note below).

## Rate-limiting and politeness recommendations

-  Stagger fetchers using `startDelaySeconds` and slightly different `pollIntervalSeconds` per fetcher.
-  Add randomized jitter (±5–15%) to each scheduled interval at runtime to avoid detectable regularity.
-  Implement a shared in-process rate limiter (token-bucket) that all fetchers consult before invoking external programs.
-  On repeated CLI errors or 429-like signals, exponentially back off the failing fetcher.

## Testing and environment notes

The repository includes unit tests under `test/` and uses `mongodb-memory-server` for store-layer tests. In some environments the in-memory MongoDB binary cannot start due to missing system libraries (e.g., `libcrypto.so.1.1`). If you see such an error:

1. Install the missing system dependency on the host (distro/package-specific).
2. Or run tests against a real MongoDB instance by setting `MONGO_URI` / `MONGO_DB` env vars.
3. Or run tests inside Docker where the necessary binaries are available.

If you prefer I can add a test harness that mocks the store or gracefully skips the in-memory test when the binary fails to start.

## Fetcher architecture

-  Fetcher classes implement a base interface and are registered in a small registry mapping `fetcherType` -> constructor.
-  The fetcher config in the manifest controls mode (poll vs one-shot), cadence, and source-specific options (e.g., subreddit and CLI path for reddit-cli).
-  Fetchers should call into a store layer (not yet implemented) to persist canonical posts.

## How campaigns and tags are stored

-  `reddit` collection (canonical posts): documents keyed by source id (`_id` = reddit id).
-  `campaign_tags` collection: documents keyed by unique compound index (postId + campaignId) storing the latest tag, confidence, classifierVersion and metadata.
-  `campaigns` collection (optional): store campaign manifests in MongoDB for dynamic updates.

## How to run (developer notes)

1. Install dependencies (not all have been added yet):

```bash
npm install
npm install execa
npm i -D typescript @types/node
```

2. Build / run (TBD - skeleton code present in `src/fetchers`)

3. Add MongoDB connection and store layer (next step)

## Testing

-  Planned: unit tests for mapper and fetcher (mock execa), integration tests using `mongodb-memory-server` for store layer.

## Implemented so far

-  Store layer: `src/store/index.ts` implements MongoDB connection, `bulkUpsertPosts`, and index creation helpers.
-  Fetchers: `src/fetchers/*` contains the fetcher base, `RedditCliFetcher`, and a registry.
-  Manifest loader: `src/manifest/loader.ts` loads campaign JSON files from `reference/campaigns`.
-  CLI entry: `src/index.ts` loads manifests and starts enabled fetchers.
-  Tests: basic tests added under `test/` for manifest loading and store upsert (uses mongodb-memory-server).

### Test note / known environment issue

The test suite uses `mongodb-memory-server` for the store tests. In some environments the in-memory MongoDB binary fails to start due to missing system libraries (example: `libcrypto.so.1.1`). If you see an error mentioning `libcrypto.so.1.1`, you have three options:

1. Install the missing system dependency on the host (package name varies by distro; for Debian/Ubuntu it may be `libssl1.1` or similar).
2. Run tests against a real MongoDB instance by setting `MONGO_URI`/`MONGO_DB` environment variables prior to running tests.
3. Run the test suite inside Docker where the required MongoDB binary dependencies are available.

If you want, I can switch the tests to gracefully skip the mongodb-memory-server test when the binary fails to start, or add a Docker-based test job.

## Contact

See project maintainer for more details.
