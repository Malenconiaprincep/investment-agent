import { LibSQLVector } from '@mastra/libsql';
import { DATA_DIR } from './config/paths';

export const researchVectors = new LibSQLVector({
  id: 'research-vectors',
  url: `file:${DATA_DIR}/research-notes.db`,
});
