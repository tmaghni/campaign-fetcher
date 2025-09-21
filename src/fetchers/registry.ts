import { FetcherConfig } from './types'
import { BaseFetcher } from './baseFetcher'
import { RedditCliFetcher } from './redditCliFetcher'

export const fetcherRegistry: Record<
   string,
   (cfg: FetcherConfig) => BaseFetcher
> = {
   'reddit-cli': (cfg) => new RedditCliFetcher(cfg),
}
