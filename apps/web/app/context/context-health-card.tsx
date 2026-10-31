import type { ContextEmbeddingHealth } from '@plusmy/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@plusmy/ui'
import * as React from 'react'

export function ContextHealthCard({ health, hasWorkspace }: {
  health: ContextEmbeddingHealth | null
  hasWorkspace: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Embedding health</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-4xl font-semibold text-foreground">
          {health ? `${health.embeddedChunks}/${health.totalChunks}` : 'Unavailable'}
        </p>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <p>
            {health
              ? `${health.chunksMissingEmbeddings} chunks missing embeddings`
              : hasWorkspace ? 'Embedding summary temporarily unavailable' : 'Select a workspace to see embedding health'}
          </p>
          <p>
            {!health
              ? 'Hidden asset count unavailable'
              : health.systemManagedAssets
                ? `${health.systemManagedAssets} hidden prompt and skill mirrors`
                : 'No hidden prompt or skill mirrors'}
          </p>
          <p>
            {!health
              ? 'Vector index health unavailable.'
              : health.embeddingIndexRecommendation
                ? health.embeddingIndexRecommendation
                : health.embeddingIndexPresent
                  ? 'Vector index present and ready for similarity lookup.'
                  : 'Vector index missing.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
