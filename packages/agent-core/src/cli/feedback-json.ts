import 'dotenv/config';

import {
  getFeedbackSummary,
  saveFeedback,
} from '../data/feedback/store.js';

async function main() {
  const command = process.argv[2];

  if (command === 'save') {
    const targetType = process.argv[3] as 'report' | 'screening';
    const targetId = process.argv[4];
    const rating = Number(process.argv[5]);
    const comment = process.argv[6];

    if (
      !targetId ||
      (targetType !== 'report' && targetType !== 'screening') ||
      (rating !== 1 && rating !== -1)
    ) {
      process.stderr.write(
        'Usage: feedback-json.ts save <report|screening> <id> <1|-1> [comment]',
      );
      process.exit(1);
    }

    const record = await saveFeedback({
      targetType,
      targetId,
      rating: rating as 1 | -1,
      comment,
    });
    const summary = await getFeedbackSummary(targetType, targetId);
    process.stdout.write(JSON.stringify({ record, summary }));
    return;
  }

  if (command === 'summary') {
    const targetType = process.argv[3] as 'report' | 'screening';
    const targetId = process.argv[4];

    if (
      !targetId ||
      (targetType !== 'report' && targetType !== 'screening')
    ) {
      process.stderr.write(
        'Usage: feedback-json.ts summary <report|screening> <id>',
      );
      process.exit(1);
    }

    const summary = await getFeedbackSummary(targetType, targetId);
    process.stdout.write(JSON.stringify(summary));
    return;
  }

  process.stderr.write('Usage: feedback-json.ts save ... | summary ...');
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
