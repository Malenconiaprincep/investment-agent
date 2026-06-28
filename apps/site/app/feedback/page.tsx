import { ContactXButton } from '@/components/ContactXButton';
import { getXHandle } from '@/lib/site-config';

export const metadata = {
  title: '反馈',
};

export default function FeedbackPage() {
  const handle = getXHandle();

  return (
    <div className="page-container page-container--narrow">
      <div className="feedback-panel">
        <h1>Beta 反馈</h1>
        <p>
          投研助手目前处于 Beta 阶段。欢迎通过 X（Twitter）直接联系我们，反馈
          Bug、功能建议或使用体验。
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            justifyContent: 'center',
          }}
        >
          <ContactXButton source="feedback_page" variant="primary" useTweetIntent>
            发推文反馈 {handle}
          </ContactXButton>
          <ContactXButton source="feedback_page_profile">
            访问 {handle}
          </ContactXButton>
        </div>
      </div>

      <section style={{ marginTop: '2rem' }}>
        <h2 className="section-title">反馈建议包含</h2>
        <ul style={{ color: 'var(--muted)', fontSize: '0.875rem', paddingLeft: '1.25rem' }}>
          <li>操作系统与版本（macOS / Windows x64 / ARM）</li>
          <li>问题复现步骤或功能场景</li>
          <li>截图（如有）</li>
          <li>使用的安装包版本（如 v0.1.0-beta）</li>
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 className="section-title">应用内反馈</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
          已安装用户可在研报、选股结果页使用「有用 / 需改进」按钮，数据保存在本地，用于改进输出质量。产品级建议仍请通过 X 联系。
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 className="section-title">Beta 测试账号</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
          桌面版安装包预置管理员 Token。如需额外测试账号，请在 X 上私信联系获取。
        </p>
      </section>
    </div>
  );
}
