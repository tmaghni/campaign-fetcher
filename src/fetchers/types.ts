export interface FetcherConfig {
   fetcherType: string
   sourceTable: string
   enabled?: boolean
   mode?: 'poll' | 'one-shot'
   pollIntervalSeconds?: number
   scheduleCron?: string | null
   limit?: number
   max?: number
   perPage?: number
   startImmediately?: boolean
   // New standardized CLI config
   // Preferred: cli is a single invocation or an array of invocations with { program, args }
   // Backward-compatible: cli may still be string[] or string[][] and cliBinary may be used
   cli?: CliInvocation | CliInvocation[] | string[] | string[][]
   cliBinary?: string // legacy: e.g. 'reddit' or full path
   startDelaySeconds?: number
   // Injected by manifest loader / index at startup
   campaignId?: string
   manifestPath?: string
   // paging and rate-limit controls
   pageUntilLastSeen?: boolean
   maxPagesPerCycle?: number
   interPageDelayMs?: number
   retry?: {
      baseMs?: number
      maxMs?: number
      maxAttempts?: number
      jitter?: number
   }
}

export interface CliInvocation {
   program: string
   args?: string[]
}

export interface CampaignManifest {
   id: string
   name: string
   sourceTable?: string
   objective?: string
   qualifier?: string
   criteria?: Record<string, any>
   labels?: Array<Record<string, any>>
   // allow single fetcher or an array of fetchers
   fetcher?: FetcherConfig | FetcherConfig[]
   metadata?: Record<string, any>
   // path to the JSON manifest file on disk (populated by loader)
   manifestPath?: string
}
