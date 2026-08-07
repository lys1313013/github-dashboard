import { useState } from 'react'

export default function TokenSetup({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState('')

  return (
    <div className="setup">
      <h1>hubdeck</h1>
      <p>输入你的 GitHub Token，查看仓库和 Actions 状态。</p>
      <ol>
        <li>
          在{' '}
          <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
            github.com/settings/tokens
          </a>{' '}
          生成 token（fine-grained 勾选 Actions 和 Metadata 的 Read 权限）
        </li>
        <li>粘贴到下面的输入框并保存</li>
      </ol>
      <form
        className="token-form"
        onSubmit={(e) => {
          e.preventDefault()
          const t = value.trim()
          if (t) onSave(t)
        }}
      >
        <input
          type="password"
          className="search"
          placeholder="粘贴 GitHub Token（github_pat_xxx / ghp_xxx）"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" className="refresh" disabled={!value.trim()}>
          保存
        </button>
      </form>
      <p className="warn">token 只保存在本机浏览器的 localStorage，不发送到任何服务器。仅限本地自用，勿部署公网。</p>
    </div>
  )
}
