import { MongoClient, Db, Collection } from 'mongodb'

export interface IStore {
   connect(): Promise<void>
   disconnect(): Promise<void>
   bulkUpsertPosts(
      collectionName: string,
      posts: any[]
   ): Promise<{ upsertedCount: number }>
   createIndexes(): Promise<void>
   // last-seen tracking for fetchers: store/get last seen unix timestamp (seconds)
   getLastSeen(key: string): Promise<number | null>
   setLastSeen(key: string, unixSeconds: number): Promise<void>
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'
const MONGO_DB = process.env.MONGO_DB || 'reddit_scraper'

let client: MongoClient | null = null
let db: Db | null = null

export const store: IStore = {
   async connect() {
      if (client) return
      client = new MongoClient(MONGO_URI)
      await client.connect()
      db = client.db(MONGO_DB)
   },
   async disconnect() {
      if (!client) return
      await client.close()
      client = null
      db = null
   },
   async bulkUpsertPosts(collectionName: string, posts: any[]) {
      if (!db) throw new Error('Not connected')
      const col: Collection = db.collection(collectionName)
      if (!Array.isArray(posts) || posts.length === 0)
         return { upsertedCount: 0 }

      const ops = posts.map((p) => {
         const doc = {
            _id: p.id,
            redditId: p.id,
            subreddit: p.subreddit || p.subreddit || null,
            title: p.title || null,
            author: p.author || null,
            createdAt: p.created_utc ? new Date(p.created_utc * 1000) : null,
            url: p.url || null,
            score: typeof p.score === 'number' ? p.score : null,
            num_comments:
               typeof p.num_comments === 'number' ? p.num_comments : null,
            permalink: p.permalink || null,
            raw: p,
            fetchedAt: new Date(),
         }
         return {
            replaceOne: {
               filter: { _id: doc._id },
               replacement: doc,
               upsert: true,
            },
         }
      })

      const res = await col.bulkWrite(ops, { ordered: false })
      return { upsertedCount: res.upsertedCount || 0 }
   },
   async createIndexes() {
      if (!db) throw new Error('Not connected')
      // Ensure campaign_tags index
      await db
         .collection('campaign_tags')
         .createIndex({ postId: 1, campaignId: 1 }, { unique: true })
      // Optional useful indexes on reddit collection
      await db.collection('reddit').createIndex({ subreddit: 1, createdAt: -1 })
      // index for fetcher state
      await db
         .collection('fetcher_state')
         .createIndex({ _id: 1 }, { unique: true })
   },
   async getLastSeen(key: string) {
      if (!db) throw new Error('Not connected')
      // cast filter to any to satisfy the driver typings for _id which may be
      // string in this small state collection.
      const doc = await db
         .collection('fetcher_state')
         .findOne<any>({ _id: key } as any)
      if (!doc || typeof doc.lastSeen !== 'number') return null
      return doc.lastSeen as number
   },
   async setLastSeen(key: string, unixSeconds: number) {
      if (!db) throw new Error('Not connected')
      await db
         .collection('fetcher_state')
         .updateOne(
            { _id: key } as any,
            { $set: { lastSeen: unixSeconds, updatedAt: new Date() } },
            { upsert: true }
         )
   },
}

export function getDb(): Db | null {
   return db
}
