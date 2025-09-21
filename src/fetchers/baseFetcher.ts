import { FetcherConfig } from './types'

export abstract class BaseFetcher {
   protected config: FetcherConfig
   protected running = false

   constructor(config: FetcherConfig) {
      this.config = config
   }

   abstract start(): Promise<void>
   abstract stop(): Promise<void>
   abstract fetchOnce(): Promise<void>

   isRunning() {
      return this.running
   }
}
