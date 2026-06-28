import Link from 'next/link';

export const metadata = {
  title: '功能说明',
};

export default function FeaturesPage() {
  return (
    <>
      <h1>功能说明</h1>
      <p>
        投研助手将 Mastra Workflow 编排为可操作的投研任务。以下为核心模块概览。
      </p>

      <h2>单股研报</h2>
      <p>
        输入股票代码（如 <code>600519</code>），触发五步 Research Workflow：采数 →
        撰写 → 质检。输出结构化 Markdown 研报，保存至历史记录，支持 👍/👎
        反馈。
      </p>
      <p>Web 入口：<code>/research</code></p>

      <h2>自动选股</h2>
      <p>
        基于问财筛选、钻石信号与因子打分，生成候选池与结构化分析报告。支持投委会式多
        Agent 维度分析（宏观、行业、财务、风险等）。
      </p>
      <p>Web 入口：<code>/screen</code></p>

      <h2>消息雷达</h2>
      <p>
        盘中扫描新闻催化与热点，自动识别相关标的并加入跟踪池。支持飞书推送通知。
      </p>
      <p>Web 入口：<code>/monitor</code></p>

      <h2>跟踪池</h2>
      <p>
        管理关注标的，支持日快照与周评回顾。对比入池以来涨跌幅与信号变化。
      </p>
      <p>
        Web 入口：<code>/watchlist</code>、<code>/reviews</code>
      </p>

      <h2>模拟盘</h2>
      <p>
        ETF 与股票双仓模拟交易，验证策略逻辑而不动用真实资金。支持定时调度与权益曲线。
      </p>
      <p>Web 入口：<code>/paper</code></p>

      <h2 id="etf">ETF 策略</h2>
      <p>
        尾盘推荐与动量轮动策略。内置回测模块可查看历史表现、鲁棒性与 Walk-forward
        验证结果。
      </p>
      <p>Web 入口：<code>/etf</code></p>

      <h2>策略回测</h2>
      <p>
        固定场景回测、鲁棒性检验与 Walk-forward 验证。可视化权益曲线与指标对比。
      </p>
      <p>Web 入口：<code>/backtest</code></p>

      <h2>Workflow 设计原则</h2>
      <ul>
        <li>输入最少：股票代码或自然语言即可触发</li>
        <li>流程可见：步骤进度始终展示</li>
        <li>结果可追溯：历史记录与数据来源标注</li>
        <li>本地优先：API Key 与研报数据保存在本地</li>
      </ul>

      <p>
        安装与配置见 <Link href="/docs/quickstart">安装与配置</Link>。
      </p>
    </>
  );
}
