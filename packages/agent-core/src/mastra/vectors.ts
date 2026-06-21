import { LibSQLVector } from '@mastra/libsql';
import { getNotesVectorUrl } from '../data/libsql-config.js';

export const researchVectors = new LibSQLVector({
  id: 'research-vectors',
  url: getNotesVectorUrl(),
});
