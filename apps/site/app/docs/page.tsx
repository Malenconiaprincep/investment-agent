import Link from 'next/link';

export const metadata = {
  title: '使用教程',
};

export default function DocsIndexPage() {
  return (
    <>
      <h1>使用教程</h1>
      <p>
        投研助手 Beta 提供 macOS 与 Windows 桌面版。下载安装后，按教程完成配置即可使用。
      </p>

      <h2>入门</h2>
      <ul>
        <li>
          <Link href="/download">下载桌面版</Link>
          — macOS / Windows 安装包
        </li>
        <li>
          <Link href="/docs/quickstart">安装与配置</Link>
          — 安装、登录、配置 DeepSeek Key
        </li>
        <li>
          <Link href="/docs/desktop">桌面版详情</Link>
          — 系统要求、数据目录与常见问题
        </li>
      </ul>

      <h2>功能</h2>
      <ul>
        <li>
          <Link href="/docs/features">功能说明</Link>
          — 单股研报、自动选股、消息雷达、模拟盘、ETF 策略与回测
        </li>
      </ul>

      <h2>法律</h2>
      <ul>
        <li>
          <Link href="/docs/disclaimer">免责声明</Link>
          — 学习研究用途，非投资建议
        </li>
      </ul>

      <h2>获取帮助</h2>
      <p>
        Beta 阶段请在 <Link href="/feedback">反馈页</Link> 通过 X 联系我们，或前往{' '}
        <Link href="/download">下载页</Link> 获取最新安装包。
      </p>
    </>
  );
}
