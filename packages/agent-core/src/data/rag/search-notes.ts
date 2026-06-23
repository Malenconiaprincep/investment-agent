import { embed } from 'ai';
import { fastembed } from '@mastra/fastembed';
import type { MastraVector } from '@mastra/core/vector';

const INDEX_NAME = 'investment_notes';

function isMissingNotesIndexError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? '');
  return /no such table:\s*investment_notes/i.test(message);
}

export type NoteHit = {
  text: string;
  file: string;
  source: string;
  score: number;
};

export type SearchNotesResult = {
  hits: NoteHit[];
  indexReady: boolean;
};

export async function searchResearchNotes(
  vectorStore: MastraVector,
  query: string,
  topK = 4,
): Promise<SearchNotesResult> {
  const { embedding } = await embed({
    model: fastembed.small,
    value: query,
  });

  let results;
  try {
    results = await vectorStore.query({
      indexName: INDEX_NAME,
      queryVector: embedding,
      topK,
    });
  } catch (error) {
    if (isMissingNotesIndexError(error)) {
      console.warn(
        '[searchResearchNotes] 笔记向量库未初始化，请运行 pnpm ingest。跳过笔记检索。',
      );
      return { hits: [], indexReady: false };
    }
    throw error;
  }

  return {
    hits: results
      .filter((item) => item.metadata?.text)
      .map((item) => ({
        text: String(item.metadata?.text ?? ''),
        file: String(item.metadata?.file ?? ''),
        source: String(item.metadata?.source ?? ''),
        score: item.score,
      })),
    indexReady: true,
  };
}
