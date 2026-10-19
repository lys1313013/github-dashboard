import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, fetchDashboard, formatCount, getCachedDashboard, timeAgo } from '../api'
import StatusBadge from '../components/StatusBadge'
import { ForkIcon, StarIcon } from '../components/icons'

type SortKey = 'updated' | 'stars' | 'name'

const AUTO_REFRESH_MS = 60_000

export default function RepoList({
  onSelect,
  onLogout,
}: {
  onSelect: (fullName: string) => void
  onLogout: () => void
}) {
  const [repos, setRepos] = useState(getCachedDashboard)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestRef = useRef<AbortController | null>(null)
  const [search, setSearch] = useState('')
  const [language, setLanguage] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')

  const load = useCallback(async (force = false) => {
    if (requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    try {
      await fetchDashboard({
        force,
        signal: controller.signal,
        onUpdate: (nextRepos) => {
          if (!controller.signal.aborted) setRepos(nextRepos)
        },
      })
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(errorMessage(e))
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, AUTO_REFRESH_MS)
    const onOnline = () => { void load(true) }
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', onOnline)
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [load])

  const pending = repos?.filter((repo) => repo.workflowState === 'loading').length ?? 0
  const failed = repos?.filter((repo) => repo.workflowState === 'error').length ?? 0

  const languages = useMemo(() => {
    if (!repos) return []
    const set = new Set<string>()
    for (const r of repos) if (r.language) set.add(r.language)
    return [...set].sort()
  }, [repos])

  const filtered = useMemo(() => {
    if (!repos) return []
    const q = search.trim().toLowerCase()
    const list = repos.filter((r) => {
      const matchQ =
        !q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
      const matchLang = !language || r.language === language
      return matchQ && matchLang
    })
    return [...list].sort((a, b) => {
      if (sort === 'stars') return b.stars - a.stars
      if (sort === 'name') return a.name.localeCompare(b.name)
      return b.pushedAt.localeCompare(a.pushedAt) || b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [repos, search, language, sort])

  return (
    <div className="page">
      <header className="toolbar">
        <h1 className="title">hubdeck</h1>
        <input
          className="search"
          placeholder="搜索仓库…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">全部语言</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="updated">最近更新</option>
          <option value="stars">Star 数</option>
          <option value="name">名称</option>
        </select>
        <button className="refresh" onClick={() => void load(true)} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
        <button className="back" onClick={onLogout} title="更换 GitHub Token">
          更换 Token
        </button>
      </header>

      {error && <div className="error" role="alert">
        {repos ? '刷新失败，已保留已加载的数据：' : '加载失败：'}{error}
      </div>}
      <div className="sync-status" role="status">
        {loading && repos && pending > 0 && `正在加载 Actions 状态（${repos.length - pending} / ${repos.length}）…`}
        {!loading && failed > 0 && `${failed} 个仓库的 Actions 状态获取失败，可点击刷新重试`}
      </div>

      <div className="repo-grid">
        {repos === null && loading && <div className="loading">加载中…</div>}
        {repos && filtered.length === 0 && <div className="empty">没有匹配的仓库</div>}
        {filtered.map((r) => (
          <button key={r.id} className="repo-card" onClick={() => onSelect(r.fullName)}>
            <div className="repo-card-head">
              <StatusBadge status={r.workflowState === 'error' ? 'unknown'
                : r.workflowState === 'loading' && !r.latestRun ? 'loading'
                : r.latestRun?.status ?? 'none'} />
              <div className="repo-name" title={r.name}>
                {r.name}
              </div>
            </div>
            <div className="repo-desc">{r.description || '—'}</div>
            <div className="repo-card-meta">
              {r.language && <span className="chip">{r.language}</span>}
              <span className="icon-with-text" title="Star">
                <StarIcon />
                {formatCount(r.stars)}
              </span>
              <span className="icon-with-text" title="Fork">
                <ForkIcon />
                {formatCount(r.forks)}
              </span>
              <span className="repo-card-time" title={r.updatedAt}>
                {timeAgo(r.pushedAt || r.updatedAt)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
