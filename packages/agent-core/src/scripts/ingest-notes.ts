import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MDocument } from '@mastra/rag';
import { fastembed } from '@mastra/fastembed';
import { embedMany } from 'ai';

import { mastra } from '../mastra/index.js';

const NOTES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data/notes',
);

const INDEX_NAME = 'investment_notes';

async function loadNoteFiles() {
  const files = await readdir(NOTES_DIR);
  const markdownFiles = files.filter((file) => file.endsWith('.md'));

  return Promise.all(
    markdownFiles.map(async (file) => {
      const content = await readFile(path.join(NOTES_DIR, file), 'utf-8');
      return {
        file,
        content,
        source: file.replace(/\.md$/, ''),
      };
    }),
  );
}

async function main() {
  const notes = await loadNoteFiles();
  const allChunks: Array<{ text: string; source: string; file: string }> = [];

  for (const note of notes) {
    const doc = MDocument.fromText(note.content, { source: note.source });
    const chunks = await doc.chunk({
      strategy: 'recursive',
      maxSize: 400,
      overlap: 50,
      separators: ['\n\n', '\n', ' '],
    });

    for (const chunk of chunks) {
      allChunks.push({
        text: chunk.text,
        source: note.source,
        file: note.file,
      });
    }
  }

  console.log(`Loaded ${notes.length} notes → ${allChunks.length} chunks`);
  console.log('Generating embeddings (first run downloads local model, may take a few minutes)...');

  const { embeddings } = await embedMany({
    model: fastembed.small,
    values: allChunks.map((chunk) => chunk.text),
  });

  const dimension = embeddings[0]?.length;
  if (!dimension) {
    throw new Error('Failed to generate embeddings');
  }

  const vectorStore = mastra.getVector('researchVectors');
  await vectorStore.createIndex({
    indexName: INDEX_NAME,
    dimension,
  });

  await vectorStore.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings,
    metadata: allChunks.map((chunk) => ({
      text: chunk.text,
      source: chunk.source,
      file: chunk.file,
    })),
  });

  console.log(`Indexed ${embeddings.length} vectors (dim=${dimension})`);
}

main().catch((error) => {
  console.error('Ingest failed:', error);
  process.exit(1);
});
