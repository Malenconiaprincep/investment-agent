import {
  generateDailyWikiReport,
  getDailyWikiPaths,
} from '../data/wiki/daily-report.js';

type WikiDailyArgs = {
  date?: string;
  dryRun: boolean;
  stdout: boolean;
  persistWorkSummary: boolean;
};

function parseDailyArgs(args: string[]): WikiDailyArgs {
  const parsed: WikiDailyArgs = {
    dryRun: false,
    stdout: false,
    persistWorkSummary: true,
  };

  for (const arg of args) {
    if (arg === '--') {
      continue;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
      parsed.persistWorkSummary = false;
    } else if (arg === '--stdout') {
      parsed.stdout = true;
    } else if (arg === '--no-work-summary-snapshot') {
      parsed.persistWorkSummary = false;
    } else if (arg.startsWith('--date=')) {
      parsed.date = arg.slice('--date='.length);
    } else {
      throw new Error(
        `未知参数: ${arg}. Usage: daily [--date=YYYY-MM-DD] [--dry-run] [--stdout] [--no-work-summary-snapshot]`,
      );
    }
  }

  return parsed;
}

export async function dispatchWiki(args: string[]): Promise<string> {
  const command = args[0] ?? 'daily';

  if (command === 'daily') {
    const parsed = parseDailyArgs(args.slice(1));
    const result = await generateDailyWikiReport({
      date: parsed.date,
      writeFiles: !parsed.dryRun,
      persistWorkSummary: parsed.persistWorkSummary && !parsed.dryRun,
    });

    if (parsed.stdout) {
      return result.markdown;
    }

    return JSON.stringify({
      date: result.report.date,
      generatedAt: result.report.generatedAt,
      dryRun: parsed.dryRun,
      markdownPath: result.report.paths.markdown,
      jsonPath: result.report.paths.json,
      overallScore: result.report.workSummary.current.overallScore,
      grade: result.report.workSummary.current.grade,
      taskFailures: result.report.scheduledTasks.summary.failed,
      observations: result.report.observations,
    });
  }

  if (command === 'paths') {
    const dateArg = args.find((arg) => arg.startsWith('--date='));
    return JSON.stringify(
      getDailyWikiPaths({
        date: dateArg ? dateArg.slice('--date='.length) : undefined,
      }),
    );
  }

  throw new Error(
    'Usage: daily [--date=YYYY-MM-DD] [--dry-run] [--stdout] [--no-work-summary-snapshot] | paths [--date=YYYY-MM-DD]',
  );
}
