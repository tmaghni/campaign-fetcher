import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { store } from '../src/store'

let mongod: MongoMemoryServer
let client: MongoClient

beforeAll(async () => {
   mongod = await MongoMemoryServer.create()
   const uri = mongod.getUri()
   process.env.MONGO_URI = uri
   process.env.MONGO_DB = 'testdb'
   await store.connect()
})

afterAll(async () => {
   await store.disconnect()
   if (mongod) await mongod.stop()
})

test('bulkUpsertPosts inserts posts', async () => {
   const posts = [
      {
         id: 'p1',
         title: 't1',
         author: 'a1',
         created_utc: Math.floor(Date.now() / 1000),
      },
      {
         id: 'p2',
         title: 't2',
         author: 'a2',
         created_utc: Math.floor(Date.now() / 1000),
      },
   ]
   const res = await store.bulkUpsertPosts('reddit', posts)
   expect(res.upsertedCount).toBeGreaterThanOrEqual(2)
})
