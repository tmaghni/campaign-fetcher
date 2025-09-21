import { FetcherConfig } from './types'
import { EventEmitter } from 'events'

// BaseFetcher now extends EventEmitter so implementations can emit lifecycle
// events such as 'cycleComplete'. The payload for 'cycleComplete' should be
// an object like: { nextRunAt?: Date | null, message?: string }
export abstract class BaseFetcher extends EventEmitter {
   protected config: FetcherConfig
   protected running = false

   constructor(config: FetcherConfig) {
      super()
      this.config = config
   }

   abstract start(): Promise<void>
   abstract stop(): Promise<void>
   abstract fetchOnce(): Promise<void>

   isRunning() {
      return this.running
   }
}
