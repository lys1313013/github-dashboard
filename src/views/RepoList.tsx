import { useEffect, useMemo, useState } from 'react'
import { fetchDashboard, formatCount, timeAgo, type RepoMeta } from '../api'
import StatusBadge from '../components/StatusBadge'
import { ForkIcon, StarIcon } from '../components/icons'

type SortKey = 'updated' | 'stars' | 'name'

export default function RepoList({
  onSelect,
  onLogout,
}: {
  onSelect: (fullName: string) => void
  onLogout: () => void
}) {
  const [repos, setRepos] = useState<RepoMeta[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [language, setLanguage] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setRepos(await fetchDashboard())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
        <button className="back" onClick={onLogout} title="更换 GitHub Token">
          更换 Token
        </button>
      </header>

      {error && <div className="error">加载失败：{error}</div>}

      <div className="repo-grid">
        {repos === null && loading && <div className="loading">加载中…</div>}
        {repos && filtered.length === 0 && <div className="empty">没有匹配的仓库</div>}
        {filtered.map((r) => (
          <button key={r.id} className="repo-card" onClick={() => onSelect(r.fullName)}>
            <div className="repo-card-head">
              <StatusBadge status={r.latestRun?.status ?? 'none'} />
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
