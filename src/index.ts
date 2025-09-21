import { loadManifests } from './manifest/loader'
import { fetcherRegistry } from './fetchers/registry'
import { BaseFetcher } from './fetchers/baseFetcher'

async function main() {
   const manifests = loadManifests()
   if (!manifests || manifests.length === 0) {
      console.log('No manifests found in reference/campaigns')
      return
   }

   const started: any[] = []
   for (const m of manifests) {
      if (!m.fetcher) continue
      const fetcherDefs = Array.isArray(m.fetcher) ? m.fetcher : [m.fetcher]
      // campaign-level logging
      console.log(`Starting campaign ${m.id} - ${m.name || ''}`)
      console.log(`  sourceTable: ${m.sourceTable || 'reddit'}`)
      console.log(`  manifest: ${m.manifestPath || 'unknown'}`)
      console.log(`  fetchers: ${fetcherDefs.length}`)
      for (const f of fetcherDefs) {
         if (f.enabled === false) continue
         const type = f.fetcherType || 'reddit-cli'
         const ctor = fetcherRegistry[type]
         if (!ctor) {
            console.warn('No fetcher registered for type', type)
            continue
         }
         const cfg = {
            ...f,
            sourceTable: f.sourceTable || m.sourceTable || '',
            campaignId: m.id,
            manifestPath: m.manifestPath,
         }
         const fetcher = ctor(cfg)
         // print fetcher-specific details
         console.log(
            `  fetcher -> type=${type} pollIntervalSeconds=${
               cfg.pollIntervalSeconds || 'n/a'
            } startDelaySeconds=${cfg.startDelaySeconds || 0}`
         )

         // listen for cycleComplete events to print status
         if ((fetcher as unknown as BaseFetcher).on) {
            const fb = fetcher as unknown as BaseFetcher
            fb.on('cycleComplete', (payload: any) => {
               const id = m.id || 'unknown-campaign'
               const next =
                  payload && payload.nextRunAt
                     ? new Date(payload.nextRunAt)
                     : null
               const msg =
                  payload && payload.message
                     ? payload.message
                     : 'cycle complete'
               if (next) {
                  console.log(`${id}: ${msg}`)
               } else {
                  console.log(`${id}: ${msg}`)
               }
            })
         }
         started.push(fetcher)
         try {
            await fetcher.start()
         } catch (err) {
            console.error('Failed to start fetcher for', m.id, err)
         }
      }
   }

   // Graceful shutdown
   process.on('SIGINT', async () => {
      console.log('Shutting down...')
      for (const f of started) {
         try {
            await f.stop()
         } catch (err) {
            // ignore
         }
      }
      process.exit(0)
   })
}

main().catch((err) => {
   console.error('Fatal error', err)
   process.exit(1)
})
