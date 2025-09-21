import { loadManifests } from '../src/manifest/loader'

describe('manifest loader', () => {
   it('loads manifests from reference/campaigns', () => {
      const ms = loadManifests()
      expect(Array.isArray(ms)).toBe(true)
      expect(ms.length).toBeGreaterThan(0)
   })
})
