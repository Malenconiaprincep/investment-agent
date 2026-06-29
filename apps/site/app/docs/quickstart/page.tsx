import Link from 'next/link';

export const metadata = {
  title: '安装与配置',
};

export default function QuickstartPage() {
  return (
    <>
      <h1>安装与配置</h1>
      <p>
        下载 macOS 或 Windows 安装包后，按以下步骤完成安装与首次配置。
      </p>

      <h2>1. 下载安装包</h2>
      <p>
        前往 <Link href="/download">下载页</Link>，选择与你系统匹配的安装包：
      </p>
      <ul>
        <li>
          <strong>macOS</strong>：dmg 或 zip
        </li>
        <li>
          <strong>Windows x64</strong>：常见 Intel / AMD 64 位 PC
        </li>
        <li>
          <strong>Windows ARM64</strong>：骁龙笔记本等设备
        </li>
        <li>
          <strong>便携版</strong>：Windows x64 免安装 exe
        </li>
      </ul>

      <h2>2. 安装并启动</h2>
      <p>
        完成安装后打开「投研助手」。首次启动会自动加载内置 Web 工作台与本地服务。
      </p>

      <h2>Beta 测试包安全提示</h2>
      <p>
        当前 Beta 测试包可能尚未完成正式代码签名与公证。系统安全提示属于
        macOS / Windows 对测试包的常见拦截，并不代表安装包内容缺失。
      </p>
      <ul>
        <li>
          <strong>macOS 提示「无法验证开发者」</strong>：打开「系统设置」→「隐私与安全性」，在底部找到「投研助手」并点击「仍要打开」。
        </li>
        <li>
          <strong>macOS 提示「文件已损坏」</strong>：先确认已将 App 拖入「应用程序」，然后在终端执行{' '}
          <code>
            sudo xattr -dr com.apple.quarantine &quot;/Applications/投研助手.app&quot;
          </code>{' '}
          后重新打开。
        </li>
        <li>
          <strong>Windows SmartScreen 提示</strong>：点击「更多信息」→「仍要运行」继续安装。
        </li>
      </ul>

      <h2>3. 登录</h2>
      <p>
        使用 Beta 测试账号登录。安装包预置管理员 Token；如需额外账号，请通过{' '}
        <Link href="/feedback">X 反馈渠道</Link> 联系获取。
      </p>

      <h2>4. 配置 DeepSeek API Key</h2>
      <p>
        登录后进入「Token 设置」(<code>/settings</code>)，填入你的 DeepSeek API
        Key：
      </p>
      <pre>
        <code>DEEPSEEK_API_KEY=sk-xxxxxxxx</code>
      </pre>
      <p>
        Key 可在{' '}
        <a
          href="https://platform.deepseek.com/api_keys"
          target="_blank"
          rel="noopener noreferrer"
        >
          DeepSeek 开放平台
        </a>{' '}
        申请。A 股行情与财务数据使用公开接口，无需额外 Key。每个账号的 Token
        独立保存在本地。
      </p>

      <h2>5. 开始使用</h2>
      <p>配置完成后，你可以：</p>
      <ul>
        <li>
          在「单股分析」输入代码（如 <code>600519</code>）生成研报
        </li>
        <li>使用「智能选股」扫描热点候选池</li>
        <li>查看「消息雷达」「跟踪池」「模拟盘」「ETF」「回测」等模块</li>
      </ul>
      <p>
        各模块详细说明见 <Link href="/docs/features">功能说明</Link>。
      </p>

      <h2>数据目录</h2>
      <p>账号数据与配置保存在本地：</p>
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
    </>
  );
}
