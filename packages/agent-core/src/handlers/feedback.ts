import { getFeedbackSummary, saveFeedback } from '../data/feedback/store.js';

export async function dispatchFeedback(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'save') {
    const targetType = args[1] as 'report' | 'screening';
    const targetId = args[2];
    const rating = Number(args[3]);
    const comment = args[4];

    if (
      !targetId ||
      (targetType !== 'report' && targetType !== 'screening') ||
      (rating !== 1 && rating !== -1)
    ) {
      throw new Error('Usage: save <report|screening> <id> <1|-1> [comment]');
    }

    const record = await saveFeedback({
      targetType,
      targetId,
      rating: rating as 1 | -1,
      comment,
    });
    const summary = await getFeedbackSummary(targetType, targetId);
    return JSON.stringify({ record, summary });
  }

  if (command === 'summary') {
    const targetType = args[1] as 'report' | 'screening';
    const targetId = args[2];
    if (!targetId || (targetType !== 'report' && targetType !== 'screening')) {
      throw new Error('Usage: summary <report|screening> <id>');
    }
    return JSON.stringify(await getFeedbackSummary(targetType, targetId));
  }

  throw new Error('Usage: save ... | summary ...');
}
