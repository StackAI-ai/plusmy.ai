import { getServerEnv } from '@plusmy/config';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const TARGET_CHARS = 1800;
const OVERLAP_CHARS = 180;

export function chunkText(content: string, targetChars = TARGET_CHARS, overlapChars = OVERLAP_CHARS) {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const end = Math.min(cursor + targetChars, normalized.length);
    chunks.push(normalized.slice(cursor, end).trim());
    if (end === normalized.length) break;
    cursor = Math.max(end - overlapChars, cursor + 1);
  }

  return chunks.filter(Boolean);
}

export async function createEmbedding(input: string): Promise<number[] | null> {
  const apiKey = getServerEnv().OPENAI_API_KEY;
  if (!apiKey || !input.trim()) {
    return null;
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Embedding request failed: ${payload}`);
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };

  return json.data?.[0]?.embedding ?? null;
}
