#!/usr/bin/env node
const { MongoClient } = require('mongodb')

async function main() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'
  const MONGO_DB = process.env.MONGO_DB || 'reddit_scraper'
  const client = new MongoClient(MONGO_URI)
  try {
    await client.connect()
    const db = client.db(MONGO_DB)
    const col = db.collection('reddit')

    // compute start of today (local) to find docs inserted today
    const now = new Date()
    const start = new Date(now)
    start.setHours(0,0,0,0)

    console.log('Looking for posts with fetchedAt >=', start.toISOString())

    const cursor = col.find({ fetchedAt: { $gte: start } })
    const docs = await cursor.toArray()
    console.log(`Found ${docs.length} posts inserted today.`)

    // Group by subreddit
    const bySub = {}
    for (const d of docs) {
      const sub = (d.subreddit || (d.raw && d.raw.subreddit) || 'unknown').toLowerCase()
      if (!bySub[sub]) bySub[sub] = []
      bySub[sub].push(d)
    }

    const report = []
    for (const [sub, arr] of Object.entries(bySub)) {
      // compute earliest createdAt in this batch
      const createdDates = arr.map(d => d.createdAt || (d.raw && d.raw.created_utc ? new Date(d.raw.created_utc * 1000) : null)).filter(Boolean)
      const earliest = createdDates.length ? new Date(Math.min(...createdDates.map(d=>d.getTime()))) : null
      const latest = createdDates.length ? new Date(Math.max(...createdDates.map(d=>d.getTime()))) : null
      const daysBack = earliest ? ((now.getTime() - earliest.getTime()) / 86400000) : null
      report.push({ subreddit: sub, count: arr.length, earliest: earliest ? earliest.toISOString() : null, latest: latest ? latest.toISOString() : null, daysBack: daysBack !== null ? Number(daysBack.toFixed(2)) : null })
    }

    report.sort((a,b) => b.count - a.count)
    console.log('Per-subreddit summary for today (sorted by count):')
    for (const r of report) {
      console.log(`- ${r.subreddit}: ${r.count} posts — earliest createdAt: ${r.earliest || 'N/A'} — days back ≈ ${r.daysBack === null ? 'N/A' : r.daysBack}`)
    }

    // Additionally, show subreddits from the manifest if present
    try {
      const fs = require('fs')
      const path = require('path')
      const mf = path.join(process.cwd(), 'reference', 'campaigns', 'ai-engineer.json')
      if (fs.existsSync(mf)) {
        const parsed = JSON.parse(fs.readFileSync(mf, 'utf8'))
        const manifestSubs = parsed.criteria && parsed.criteria.subreddits ? parsed.criteria.subreddits : parsed.criteria ? parsed.criteria.subreddits : parsed.subreddits || []
        if (Array.isArray(manifestSubs) && manifestSubs.length) {
          console.log('\nSubreddits in manifest but missing from today:')
          for (const s of manifestSubs) {
            const key = (s || '').toLowerCase()
            if (!bySub[key]) console.log(`- ${s}`)
          }
        }
      }
    } catch (e) {
      // ignore
    }

    process.exit(0)
  } catch (err) {
    console.error('Error', err)
    process.exit(2)
  } finally {
    try { await client.close() } catch(e){}
  }
}

main()
