import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextHealthCard } from '../app/context/context-health-card'

test('unavailable context health is not presented as zero or a missing index', () => {
  const html = renderToStaticMarkup(<ContextHealthCard health={null} hasWorkspace />)
  assert.match(html, /Embedding summary temporarily unavailable/)
  assert.match(html, /Vector index health unavailable/)
  assert.doesNotMatch(html, /0\/0|Vector index missing\./)
})

test('a workspace must be selected before health can be shown', () => {
  const html = renderToStaticMarkup(<ContextHealthCard health={null} hasWorkspace={false} />)
  assert.match(html, /Select a workspace to see embedding health/)
})

test('available context health renders counts and index status', () => {
  const html = renderToStaticMarkup(<ContextHealthCard hasWorkspace health={{
    totalAssets: 2,
    visibleAssets: 1,
    systemManagedAssets: 1,
    totalChunks: 3,
    embeddedChunks: 2,
    chunksMissingEmbeddings: 1,
    lastEmbeddedAt: null,
    embeddingIndexName: 'test-index',
    embeddingIndexPresent: true,
    embeddingIndexStatus: 'healthy',
    embeddingIndexRecommendation: null
  }} />)
  assert.match(html, /2\/3/)
  assert.match(html, /1 chunks missing embeddings/)
  assert.match(html, /1 hidden prompt and skill mirrors/)
  assert.match(html, /Vector index present and ready/)
})
