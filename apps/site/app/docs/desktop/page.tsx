import Link from 'next/link';

export const metadata = {
  title: '桌面版',
};

export default function DesktopPage() {
  return (
    <>
      <h1>桌面版说明</h1>
      <p>
        桌面版（Electron）将 Web 工作台与 agent-core 服务打包在一起，安装后本地运行，适合日常投研使用。
      </p>

      <h2>下载与安装</h2>
      <p>
        前往 <Link href="/download">下载页</Link> 获取最新 macOS / Windows
        安装包，选择与你设备匹配的版本。
      </p>
      <ul>
        <li>
          <strong>macOS</strong>：dmg 或 zip，适用于 Apple Silicon 与 Intel
        </li>
        <li>
          <strong>Windows x64</strong>：常见 Intel / AMD 64 位系统
        </li>
        <li>
          <strong>Windows ARM64</strong>：骁龙笔记本、Surface Pro X 等
        </li>
        <li>
          <strong>便携版</strong>：x64 免安装 exe
        </li>
      </ul>

      <h2>首次启动</h2>
      <ol>
        <li>安装并打开「投研助手」</li>
        <li>使用 Beta 测试账号登录（安装包预置管理员 Token）</li>
        <li>如需额外账号，请通过 X 联系获取</li>
        <li>在「Token 设置」确认 DeepSeek API Key 已配置</li>
      </ol>
      <p>
        详细步骤见 <Link href="/docs/quickstart">安装与配置</Link>。
      </p>

      <h2>数据与配置目录</h2>
      <p>每个账号的 Token 与数据独立保存：</p>
      <ul>
        <li>
          <strong>macOS</strong>：{' '}
          <code>
            ~/Library/Application Support/投研助手/data/users/&#123;账号&#125;/
          </code>
        </li>
        <li>
          <strong>Windows</strong>：{' '}
          <code>%APPDATA%/投研助手/data/users/&#123;账号&#125;/</code>
        </li>
      </ul>

      <h2>常见问题</h2>
      <ul>
        <li>
          <strong>macOS 提示无法验证开发者</strong>：打开「系统设置」→「隐私与安全性」，在底部找到「投研助手」并点击「仍要打开」
        </li>
        <li>
          <strong>macOS 提示文件已损坏</strong>：Beta 测试包可能需要手动移除隔离标记。确认 App 已拖入「应用程序」后，在终端执行{' '}
          <code>
            sudo xattr -dr com.apple.quarantine &quot;/Applications/投研助手.app&quot;
          </code>{' '}
          并重新打开
        </li>
        <li>
          <strong>Windows SmartScreen 拦截</strong>：点击「更多信息」→「仍要运行」继续安装
        </li>
        <li>
          <strong>Windows 提示需要 64 位系统</strong>：32 位 Windows 不支持
          Electron 35，请升级系统后安装 x64 版本
        </li>
        <li>
          <strong>ARM 设备</strong>：请下载 arm64 安装包，不要用 x64 包
        </li>
        <li>
          <strong>无法连接后端</strong>：确认桌面版内置服务已启动，重启应用后再试
        </li>
        <li>
          <strong>暂无安装包</strong>：下载页尚未发布新版本时，请通过{' '}
          <Link href="/feedback">X 反馈渠道</Link> 联系获取
        </li>
      </ul>
    </>
  );
}
