import { embed } from 'ai';
import { fastembed } from '@mastra/fastembed';
import type { MastraVector } from '@mastra/core/vector';

const INDEX_NAME = 'investment_notes';

export type NoteHit = {
  text: string;
  file: string;
  source: string;
  score: number;
};

export async function searchResearchNotes(
  vectorStore: MastraVector,
  query: string,
  topK = 4,
): Promise<NoteHit[]> {
  const { embedding } = await embed({
    model: fastembed.small,
    value: query,
  });

  const results = await vectorStore.query({
    indexName: INDEX_NAME,
    queryVector: embedding,
    topK,
  });

  return results
    .filter((item) => item.metadata?.text)
    .map((item) => ({
      text: String(item.metadata?.text ?? ''),
      file: String(item.metadata?.file ?? ''),
      source: String(item.metadata?.source ?? ''),
      score: item.score,
    }));
}
