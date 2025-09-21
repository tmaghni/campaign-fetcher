import fs from 'fs'
import path from 'path'
import { CampaignManifest } from '../fetchers/types'

export function loadManifests(
   dir = path.join(process.cwd(), 'reference', 'campaigns')
): CampaignManifest[] {
   if (!fs.existsSync(dir)) return []
   const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
   const manifests: CampaignManifest[] = []
   for (const f of files) {
      try {
         const raw = fs.readFileSync(path.join(dir, f), 'utf8')
         const parsed = JSON.parse(raw) as CampaignManifest
         manifests.push(parsed)
      } catch (err) {
         // eslint-disable-next-line no-console
         console.error('Failed to load manifest', f, err)
      }
   }
   return manifests
}
