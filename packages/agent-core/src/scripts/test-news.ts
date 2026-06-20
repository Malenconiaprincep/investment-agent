import 'dotenv/config';

import { searchNews } from '../data/market/services.js';

async function main() {
  try {
    const result = await searchNews('600519', 7);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('FAIL:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
