import { BaseFetcher } from './baseFetcher'
import { FetcherConfig, CliInvocation } from './types'
import execaWrapper from '../utils/execaWrapper'
import { store } from '../store'
import crypto from 'crypto'

export class RedditCliFetcher extends BaseFetcher {
   constructor(config: FetcherConfig) {
      super(config)
   }

   async start(): Promise<void> {
      if (this.config.mode === 'poll') {
         this.running = true
         const interval = (this.config.pollIntervalSeconds || 300) * 1000
         // Simple polling loop (in-process)
         const loop = async () => {
            if (!this.running) return
            try {
               await this.fetchOnce()
            } catch (err) {
               // eslint-disable-next-line no-console
               console.error('fetchOnce error', err)
            }
            if (this.running) {
               // calculate next run time and emit an event so callers can log it
               const nextRunAt = new Date(Date.now() + interval)
               try {
                  this.emit('cycleComplete', {
                     nextRunAt,
                     message: `Waiting until ${nextRunAt.toLocaleString()} to continue`,
                  })
               } catch (e) {
                  // ignore
               }
               setTimeout(loop, interval)
            }
         }
         // Honor optional startDelaySeconds to stagger first run without blocking
         const delayMs = (this.config.startDelaySeconds || 0) * 1000
         const scheduleFirst = () => {
            if (this.config.startImmediately !== false) {
               loop()
            } else {
               setTimeout(loop, interval)
            }
         }
         if (delayMs > 0) {
            setTimeout(() => {
               if (!this.running) return
               scheduleFirst()
            }, delayMs)
         } else {
            scheduleFirst()
         }
      } else {
         // one-shot
         const delayMs = (this.config.startDelaySeconds || 0) * 1000
         if (delayMs > 0) {
            setTimeout(() => {
               if (!this.running) return
               // don't await here — one-shot should run and return
               this.fetchOnce()
                  .then(() => {
                     try {
                        this.emit('cycleComplete', {
                           nextRunAt: null,
                           message: 'One-shot fetch complete',
                        })
                     } catch (e) {
                        // ignore
                     }
                  })
                  .catch((err) => console.error('fetchOnce error', err))
            }, delayMs)
         } else {
            await this.fetchOnce()
         }
      }
   }

   async stop(): Promise<void> {
      this.running = false
   }

   async fetchOnce(): Promise<void> {
      // Normalize and support multiple CLI invocation shapes:
      // - New preferred shape: cli is CliInvocation or CliInvocation[] where CliInvocation = { program, args }
      // - Legacy shapes: cli as string[] (single invocation) or string[][] (array of invocations) with cliBinary
      const invocations: CliInvocation[] = []

      if (this.config.cli) {
         // New object form
         if (typeof (this.config.cli as any).program === 'string') {
            const c = this.config.cli as unknown as CliInvocation
            invocations.push({ program: c.program, args: c.args || [] })
         } else if (
            Array.isArray(this.config.cli) &&
            (this.config.cli as any).length > 0 &&
            typeof (this.config.cli as any)[0] === 'object' &&
            (this.config.cli as any)[0].program
         ) {
            const arr = this.config.cli as unknown as CliInvocation[]
            for (const c of arr)
               invocations.push({ program: c.program, args: c.args || [] })
         } else if (
            Array.isArray(this.config.cli) &&
            (this.config.cli as any).length > 0 &&
            typeof (this.config.cli as any)[0] === 'string'
         ) {
            // legacy single token array
            const args = this.config.cli as unknown as string[]
            invocations.push({
               program: this.config.cliBinary || 'reddit',
               args,
            })
         } else if (
            Array.isArray(this.config.cli) &&
            (this.config.cli as any).length > 0
         ) {
            // legacy array-of-arrays
            const arr = this.config.cli as unknown as string[][]
            for (const a of arr)
               invocations.push({
                  program: this.config.cliBinary || 'reddit',
                  args: a,
               })
         }
      }

      // If no invocations were configured, build a default one
      if (invocations.length === 0) {
         const perPage = this.config.perPage || this.config.limit || 25
         const max = this.config.max
         const defaultArgs = [
            'list',
            '--subreddit',
            'forhire',
            '--sort',
            'new',
            '--per-page',
            String(perPage),
         ]
         if (typeof max === 'number') defaultArgs.push('--max', String(max))
         if (this.config.limit && !this.config.max)
            defaultArgs.push('--limit', String(this.config.limit))
         invocations.push({
            program: this.config.cliBinary || 'reddit',
            args: defaultArgs,
         })
      }

      // Support optional paging behavior: issue repeated invocations until we've
      // caught up to lastSeen (if pageUntilLastSeen=true) or until maxPagesPerCycle
      const perPage = this.config.perPage || this.config.limit || 25
      const pageUntilLastSeen = !!this.config.pageUntilLastSeen
      const maxPages = this.config.maxPagesPerCycle || 10
      const interPageDelayMs = this.config.interPageDelayMs ?? 1000
      const retryCfg = this.config.retry || {
         baseMs: 500,
         maxMs: 30000,
         maxAttempts: 5,
         jitter: 0.2,
      }

      const allPosts: any[] = []

      // state key to check lastSeen early (compute now)
      const keyParts = [
         this.config.campaignId || '',
         (invocations[0]?.args || []).join(' '),
      ]
      const stateKey =
         'fetcher:' +
         crypto.createHash('sha1').update(keyParts.join('|')).digest('hex')
      await store.connect()
      const lastSeen = (await store.getLastSeen(stateKey)) || 0

      let pagesFetched = 0
      let stopPaging = false
      let pageToken: string | null = null

      while (!stopPaging && pagesFetched < maxPages) {
         // Build invocation args for this page. If CLI supports paging tokens/offsets,
         // manifest authors should include placeholders or different invocations. For
         // simplicity we'll append --per-page and optionally --page or --after when
         // present in args; this keeps compatibility with simple CLIs.
         const inv = invocations[0]
         let args = [...(inv.args || [])]
         // ensure per-page param exists
         if (!args.includes('--per-page') && !args.includes('-n')) {
            args = args.concat(['--per-page', String(perPage)])
         }
         // append page token/offset if present (this is CLI-dependent; if your
         // CLI uses `--after` or `--page` modify the manifest accordingly)
         if (pageToken) args = args.concat(['--after', pageToken])

         // run with retry/backoff
         let attempt = 0
         let lastErr: any = null
         while (attempt < (retryCfg.maxAttempts || 5)) {
            // eslint-disable-next-line no-console
            console.log(
               'Running',
               inv.program,
               args.join(' '),
               `(page ${pagesFetched + 1})`
            )
            const result = await execaWrapper.run(inv.program, args || [])
            if (result.statusCode === 429 || result.retryAfterSeconds) {
               // rate-limited
               const retryAfter =
                  result.retryAfterSeconds ??
                  Math.min(
                     retryCfg.maxMs || 30000,
                     ((retryCfg.baseMs || 500) * Math.pow(2, attempt)) / 1000
                  )
               const backoffMs = Math.min(
                  retryCfg.maxMs || 30000,
                  (retryCfg.baseMs || 500) * Math.pow(2, attempt)
               )
               const jitter = Math.floor(
                  (Math.random() - 0.5) * ((retryCfg.jitter || 0.2) * backoffMs)
               )
               const waitMs = Math.max(0, backoffMs + jitter)
               const nextRunAt = new Date(
                  Date.now() +
                     (result.retryAfterSeconds
                        ? result.retryAfterSeconds * 1000
                        : waitMs)
               )
               // eslint-disable-next-line no-console
               console.warn(
                  `Rate limited (429). Pausing until ${nextRunAt.toLocaleString()}`
               )
               try {
                  this.emit('cycleComplete', {
                     nextRunAt,
                     message: `Rate limited; pausing until ${nextRunAt.toLocaleString()}`,
                  })
               } catch (e) {}
               return
            }

            const stdout = result.stdout
            let parsed: any
            try {
               parsed = JSON.parse(stdout)
            } catch (err) {
               lastErr = err
               attempt += 1
               const backoffMs = Math.min(
                  retryCfg.maxMs || 30000,
                  (retryCfg.baseMs || 500) * Math.pow(2, attempt)
               )
               const jitter = Math.floor(
                  (Math.random() - 0.5) * ((retryCfg.jitter || 0.2) * backoffMs)
               )
               const waitMs = Math.max(0, backoffMs + jitter)
               // eslint-disable-next-line no-console
               console.warn(
                  `Failed to parse CLI output, retrying in ${waitMs}ms (attempt ${attempt})`
               )
               await new Promise((r) => setTimeout(r, waitMs))
               continue
            }

            // successful parse — append posts
            if (Array.isArray(parsed)) {
               allPosts.push(...parsed)
            }

            // If parsed supports a paging token/cursor, capture it. This is CLI-specific
            // and relies on the CLI returning a `after` or similar token in the JSON. If
            // not present, we'll just rely on page counts and created_utc checks.
            pageToken = parsed && parsed.after ? parsed.after : null

            pagesFetched += 1

            // Stop conditions:
            // - if not pagingUntilLastSeen, we only fetch one page
            // - if we found a post older/equal to lastSeen in this page, we can stop
            if (!pageUntilLastSeen) {
               stopPaging = true
            } else {
               // check if any item in parsed has created_utc <= lastSeen
               if (Array.isArray(parsed)) {
                  const foundOld = parsed.some((p: any) => {
                     const ts =
                        typeof p.created_utc === 'number'
                           ? p.created_utc
                           : Number(p.created_utc)
                     return typeof ts === 'number' && ts <= lastSeen
                  })
                  if (foundOld) stopPaging = true
               }
               // if no pageToken and parsed length < perPage, we might be at the end
               if (
                  !pageToken &&
                  Array.isArray(parsed) &&
                  parsed.length < perPage
               )
                  stopPaging = true
            }

            // wait a bit between pages to avoid bursts
            if (!stopPaging && interPageDelayMs > 0)
               await new Promise((r) => setTimeout(r, interPageDelayMs))
            break
         }

         if (pagesFetched >= maxPages) {
            // eslint-disable-next-line no-console
            console.warn(
               `Reached maxPagesPerCycle (${maxPages}), stopping this cycle.`
            )
            break
         }
      }

      if (allPosts.length === 0) {
         // eslint-disable-next-line no-console
         console.log('No posts fetched')
         try {
            this.emit('cycleComplete', {
               nextRunAt:
                  this.config.mode === 'poll'
                     ? new Date(
                          Date.now() +
                             (this.config.pollIntervalSeconds || 300) * 1000
                       )
                     : null,
               message: 'No posts fetched this cycle',
            })
         } catch (e) {
            // ignore
         }
         return
      }

      const collectionName = this.config.sourceTable || 'reddit'
      try {
         // now persist in a deduplicated way using lastSeen key (recompute key)
         const finalKeyParts = [
            this.config.campaignId || '',
            (invocations[0]?.args || []).join(' '),
         ]
         const finalStateKey =
            'fetcher:' +
            crypto
               .createHash('sha1')
               .update(finalKeyParts.join('|'))
               .digest('hex')
         const finalLastSeen = (await store.getLastSeen(finalStateKey)) || 0

         const newPosts = allPosts.filter((p) => {
            const ts =
               typeof p.created_utc === 'number'
                  ? p.created_utc
                  : Number(p.created_utc)
            return typeof ts === 'number' && ts > finalLastSeen
         })

         if (newPosts.length === 0) {
            // eslint-disable-next-line no-console
            console.log('No new posts since last run')
         } else {
            const result = await store.bulkUpsertPosts(collectionName, newPosts)
            // eslint-disable-next-line no-console
            console.log(
               `Upserted ${result.upsertedCount} posts into ${collectionName}`
            )

            // update lastSeen to the max created_utc we just processed
            const maxTs = Math.max(
               ...newPosts.map((p) => (p.created_utc as number) || 0)
            )
            if (maxTs > finalLastSeen) {
               await store.setLastSeen(finalStateKey, Math.floor(maxTs))
            }
         }
      } catch (err) {
         // eslint-disable-next-line no-console
         console.error('Failed to persist posts', err)
         try {
            this.emit('cycleComplete', {
               nextRunAt:
                  this.config.mode === 'poll'
                     ? new Date(
                          Date.now() +
                             (this.config.pollIntervalSeconds || 300) * 1000
                       )
                     : null,
               message: 'Failed to persist posts',
            })
         } catch (e) {
            // ignore
         }
      }
   }
}
