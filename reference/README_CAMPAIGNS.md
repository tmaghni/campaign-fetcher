AI campaigns reference

## Purpose

This document collects the decisions, data models and usage patterns for the reddit-scraper project campaigns and tagging workflow. It is intended as a handoff for a model or a human engineer who needs to implement or operate the classifier pipeline.

## Contents

-  Overview
-  Collections and schemas
-  Campaign object structure (example)
-  Classifier integration
-  Common operations
-  Indexing and performance notes
-  Example workflows

## Overview

The system ingests Reddit posts (via a globally-installed `reddit` CLI), stores them in MongoDB (collection `reddit`), and allows independent "campaigns" to classify/tag posts. Campaigns define objectives, labels and machine-friendly criteria. Classifier microservices analyze post content and write per-campaign tags to the `campaign_tags` collection.

## Collections and Schemas

1. reddit (canonical posts)

-  \_id: string (reddit id)
-  redditId: string
-  subreddit: string
-  title: string
-  author: string
-  createdAt: ISODate
-  url: string
-  num_comments: number
-  score: number
-  permalink: string
-  raw: object (original CLI output)
-  fetchedAt: ISODate
-  latestCampaignTags: object (optional denormalized cache)

Indexes:

-  \_id is unique (using reddit id)
-  Optional: { subreddit: 1, createdAt: -1 }

2. campaign_tags (per-campaign tags)

-  \_id: ObjectId
-  postId: string (references reddit.\_id)
-  campaignId: string
-  tag: string
-  confidence: number (optional)
-  classifierVersion: string (optional)
-  metadata: object (optional)
-  taggedAt: ISODate
-  updatedAt: ISODate

Indexes:

-  { postId: 1, campaignId: 1 } unique
-  { campaignId: 1, tag: 1, postId: 1 }
-  { postId: 1 }

3. campaigns (campaign definitions)

-  \_id: string (e.g., "ai-engineer")
-  name: string
-  objective: string
-  qualifier: string (human summary)
-  criteria: object (keywords/patterns/examples/heuristics)
-  labels: array (label definitions)
-  default_label: string
-  thresholds: object
-  classifierHints: object
-  metadata: object

## Campaign object structure (example)

See `reference/campaigns/ai-engineer.json` for a complete example. Campaigns include:

-  configuration for LLMs/classifiers (criteria and hints)
-  label definitions and recommended actions
-  thresholds for converting numeric confidence to labels

## Classifier Integration

-  Classifier receives post data (title, optionally body), and a campaign definition.
-  It returns a structured array: [{ postId, tag, confidence, metadata }, ...]
-  The tag-writer performs bulk upsert to `campaign_tags` keyed by { postId, campaignId }
-  Optionally update reddit.latestCampaignTags[campaignId] as a denormalized cache.

## Common Operations

-  Ingest posts: run `reddit list --subreddit ...` and upsert into `reddit` collection using \_id=post.id
-  Tag posts: classifier returns tags; perform bulkWrite upserts into `campaign_tags` with filter { postId, campaignId }
-  Query prospects: query `campaign_tags` for campaignId + tag and join to `reddit` via $lookup or separate query
-  Find unprocessed posts: list reddit posts where campaign_tags has no document for campaignId (via exclusion or left join)

## Indexing and performance notes

-  Use ordered:false bulkWrite for throughput and resilience
-  Keep `campaign_tags` normalized; avoid embedding many campaigns inside `reddit` docs to prevent document growth
-  Denormalize latest tags into `reddit` only if you need very low-latency reads; accept eventual consistency

## Example workflows

1. One-shot ingestion

-  Run the fetcher once (or via cron): `reddit list --subreddit r/forhire --sort new --limit 100` and upsert

2. Bulk classification

-  Classifier processes batches, returns tags for campaign `ai-engineer`
-  Tag-writer bulk upserts into `campaign_tags`
-  Optional: update `reddit.latestCampaignTags.ai-engineer` for fast lookup

## Where files live

-  Campaign examples: `reference/campaigns/*.json`
-  This README: `reference/README_CAMPAIGNS.md`

## Next steps

-  Implement the TypeScript service (fetcher, store, tag-writer)
-  Add automated tests using mongodb-memory-server
-  Add scripts to create necessary indexes on startup or migrations
-  Optional: implement a tiny REST endpoint to accept classifier outputs

## Contact

For questions, modifications or operational runbook details, refer to the project maintainer.
