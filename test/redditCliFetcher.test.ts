import { RedditCliFetcher } from '../src/fetchers/redditCliFetcher'
import { FetcherConfig } from '../src/fetchers/types'

jest.mock('../src/utils/execaWrapper')
jest.mock('../src/store')

const execaWrapper = require('../src/utils/execaWrapper')
const store = require('../src/store')

describe('RedditCliFetcher', () => {
   beforeEach(() => {
      jest.resetAllMocks()
   })

   it('parses posts from CLI and calls store.bulkUpsertPosts', async () => {
      const samplePosts = [
         { id: 'abc', title: 'Test' },
         { id: 'def', title: 'Another' },
      ]
      execaWrapper.run.mockResolvedValue({
         stdout: JSON.stringify(samplePosts),
      })
      // `src/store` exports a named `store` object
      if (!store.store) store.store = {}
      store.store.bulkUpsertPosts = jest
         .fn()
         .mockResolvedValue({ upsertedCount: 2 })
      store.store.connect = jest.fn().mockResolvedValue(null)

      const cfg: FetcherConfig = {
         fetcherType: 'reddit-cli',
         sourceTable: 'reddit',
         mode: 'one-shot',
         cli: { program: 'reddit', args: ['list', '--subreddit', 'forhire'] },
      }

      const f = new RedditCliFetcher(cfg)
      await f.fetchOnce()

      expect(execaWrapper.run).toHaveBeenCalled()
      expect(store.store.connect).toHaveBeenCalled()
      expect(store.store.bulkUpsertPosts).toHaveBeenCalledWith(
         'reddit',
         samplePosts
      )
   })
})
