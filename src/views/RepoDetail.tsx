import { useEffect, useState } from 'react'
import { fetchWorkflowRuns, timeAgo, type WorkflowRunSummary } from '../api'
import StatusBadge from '../components/StatusBadge'

export default function RepoDetail({
  owner,
  repo,
  onBack,
}: {
  owner: string
  repo: string
  onBack: () => void
}) {
  const [runs, setRuns] = useState<WorkflowRunSummary[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setRuns(await fetchWorkflowRuns(`${owner}/${repo}`, 15))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [owner, repo])

  return (
    <div className="page">
      <header className="toolbar">
        <button className="back" onClick={onBack}>
          ← 返回
        </button>
        <h1 className="title">
          {owner}/{repo}
        </h1>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      {error && <div className="error">加载失败：{error}</div>}

      <div className="runs">
        {runs === null && loading && <div className="loading">加载中…</div>}
        {runs && runs.length === 0 && <div className="empty">这个仓库没有 Actions runs</div>}
        {runs?.map((run) => (
          <a key={run.id} className="run-row" href={run.htmlUrl} target="_blank" rel="noreferrer">
            <StatusBadge status={run.status} />
            <div className="run-main">
              <div className="run-name">{run.workflowName}</div>
              <div className="run-sub">
                #{run.runNumber} · {run.event}
                {run.headBranch ? ` · ${run.headBranch}` : ''} · {run.headSha.slice(0, 7)}
              </div>
            </div>
            <div className="repo-meta">
              <span>{duration(run.createdAt, run.updatedAt)}</span>
              <span className="time">{timeAgo(run.createdAt)}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

function duration(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
