export const metadata = {
  title: '免责声明',
};

export default function DisclaimerPage() {
  return (
    <>
      <h1>免责声明</h1>
      <p>
        本仓库中的投研 Agent 及相关输出<strong>仅供学习、研究与信息整理</strong>
        ，不构成任何投资建议、荐股或收益承诺。
      </p>

      <h2>重要提示</h2>
      <ol>
        <li>
          <strong>非投资建议</strong>：Agent
          生成的内容不能替代专业投资顾问意见，请勿据此直接买卖证券。
        </li>
        <li>
          <strong>数据准确性</strong>：行情与财务数据来自公开接口，可能存在延迟、错误或遗漏，请务必人工核实。
        </li>
        <li>
          <strong>投资风险</strong>：证券投资有风险，过往表现不代表未来收益，请独立判断并自行承担投资风险。
        </li>
        <li>
          <strong>合规使用</strong>：请遵守相关法律法规及数据提供方的使用条款。
        </li>
      </ol>

      <h2>数据标注要求</h2>
      <p>所有 Agent 输出应包含：</p>
      <ul>
        <li>数据来源（dataSource）</li>
        <li>数据时效（asOf）</li>
        <li>不确定性说明与「待人工核实」清单（如适用）</li>
      </ul>

      <p>
        <em>
          本项目为个人学习与 Agent 工程实践项目，作者不对因使用本项目而产生的任何损失承担责任。
        </em>
      </p>
    </>
  );
}
