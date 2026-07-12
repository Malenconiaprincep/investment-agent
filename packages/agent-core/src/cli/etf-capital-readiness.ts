import '../config/load-env.js';

import { generateEtfEvergreenCapitalReadiness } from '../data/etf/capital-readiness.js';

const asOf = process.argv.find((arg) => arg.startsWith('--as-of='))?.slice('--as-of='.length);

generateEtfEvergreenCapitalReadiness({ asOfDate: asOf })
  .then((report) => process.stdout.write(JSON.stringify(report, null, 2)))
  .catch((error) => {
    process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
