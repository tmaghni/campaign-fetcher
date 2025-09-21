import { BaseFetcher } from './baseFetcher'
import { FetcherConfig, CliInvocation } from './types'
import execaWrapper from '../utils/execaWrapper'
import { store } from '../store'

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

      const allPosts: any[] = []
      for (const inv of invocations) {
         // eslint-disable-next-line no-console
         console.log('Running', inv.program, (inv.args || []).join(' '))
         const result = await execaWrapper.run(inv.program, inv.args || [])
         const stdout = result.stdout
         let parsed: any
         try {
            parsed = JSON.parse(stdout)
         } catch (err) {
            // eslint-disable-next-line no-console
            console.error(
               'Failed to parse output for',
               inv.program,
               inv.args,
               err
            )
            continue
         }
         if (Array.isArray(parsed)) allPosts.push(...parsed)
      }

      if (allPosts.length === 0) {
         // eslint-disable-next-line no-console
         console.log('No posts fetched')
         try {
            this.emit('cycleComplete', {
               nextRunAt: this.config.mode === 'poll'
                  ? new Date(Date.now() + (this.config.pollIntervalSeconds || 300) * 1000)
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
         await store.connect()
         const result = await store.bulkUpsertPosts(collectionName, allPosts)
         // eslint-disable-next-line no-console
         console.log(
            `Upserted ${result.upsertedCount} posts into ${collectionName}`
         )
      } catch (err) {
         // eslint-disable-next-line no-console
         console.error('Failed to persist posts', err)
         try {
            this.emit('cycleComplete', {
               nextRunAt: this.config.mode === 'poll'
                  ? new Date(Date.now() + (this.config.pollIntervalSeconds || 300) * 1000)
                  : null,
               message: 'Failed to persist posts',
            })
         } catch (e) {
            // ignore
         }
      }
   }
}
