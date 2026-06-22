import 'dotenv/config';

import { runSectorScreenStream } from '../api/run-sector-screen-stream.js';

async function main() {
  const queryArg = process.argv.slice(2).join(' ').trim();
  const input = queryArg
    ? { query: queryArg, maxCandidates: 10, excludeSt: true, lookbackDays: 14 }
    : { maxCandidates: 10, excludeSt: true, lookbackDays: 14 };
  let summary = '';

  await runSectorScreenStream(input, (event) => {
    if (event.type === 'step') {
      console.log(`\n[${event.label}]`);
    }
    if (event.type === 'hotNews') {
      console.log(`\n自动主题：${event.query}`);
      for (const item of event.hotNews.slice(0, 5)) {
        console.log(`  · ${item.title}`);
      }
    }
    if (event.type === 'token') {
      process.stdout.write(event.text);
      summary += event.text;
    }
    if (event.type === 'done') {
      console.log('\n\n--- 候选股 ---');
      for (const c of event.candidates) {
        console.log(`${c.symbol} ${c.name} — ${c.thesis.slice(0, 60)}`);
      }
      if (event.tailEntryRun) {
        console.log(`\n--- 明日预判 (${event.tailEntryRun.status}) ---`);
        console.log(event.tailEntryRun.message);
      }
      if (event.tailEntryOutlook) {
        console.log('\n--- 明日预判 ---');
        for (const sector of event.tailEntryOutlook.sectorPicks.slice(0, 5)) {
          console.log(
            `${sector.name} ★${sector.priorityStars} 涨${sector.pctChg.toFixed(2)}% 净流入${sector.netInflowYi.toFixed(1)}亿`,
          );
        }
        console.log('\n--- 尾盘参考（主力净流入） ---');
        for (const stock of event.tailEntryOutlook.topInflowStocks.slice(0, 5)) {
          console.log(`${stock.symbol} ${stock.name} 涨${stock.pctChg.toFixed(2)}%`);
        }
      }
      console.log(`\n质检: ${event.passed ? 'PASS' : 'FAIL'}`);
      if (!event.passed) {
        if (event.missingSections.length > 0) {
          console.log(`缺少: ${event.missingSections.join(', ')}`);
        }
        if (event.missingKeywords.length > 0) {
          console.log(`缺少关键词: ${event.missingKeywords.join(', ')}`);
        }
      }
    }
    if (event.type === 'error') {
      console.error('ERROR:', event.message);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
