import { loadManifests } from './manifest/loader'
import { fetcherRegistry } from './fetchers/registry'

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
      for (const f of fetcherDefs) {
         if (f.enabled === false) continue
         const type = f.fetcherType || 'reddit-cli'
         const ctor = fetcherRegistry[type]
         if (!ctor) {
            console.warn('No fetcher registered for type', type)
            continue
         }
         const cfg = { ...f, sourceTable: f.sourceTable || m.sourceTable || '' }
         const fetcher = ctor(cfg)
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
