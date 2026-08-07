const BASE = 'https://api.github.com'
const TOKEN_KEY = 'hubdeck.token'

export type RunStatus = 'success' | 'failure' | 'running' | 'neutral' | 'attention'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export interface WorkflowRunSummary {
  id: number
  runNumber: number
  workflowName: string
  event: string
  headBranch: string | null
  headSha: string
  status: RunStatus
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export interface RepoMeta {
  id: number
  fullName: string
  name: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  updatedAt: string
  pushedAt: string
  defaultBranch: string
  visibility: string
  archived: boolean
  latestRun: WorkflowRunSummary | null
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  if (!token) throw new GitHubError(401, '未配置 GitHub Token')
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function ghFetch(path: string): Promise<Response> {
  let res = await fetch(`${BASE}${path}`, { headers: authHeaders() })
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 5
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
    res = await fetch(`${BASE}${path}`, { headers: authHeaders() })
  }
  return res
}

function mapRunStatus(status: string, conclusion: string | null): RunStatus {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return 'success'
      case 'failure':
      case 'timed_out':
        return 'failure'
      case 'action_required':
        return 'attention'
      default:
        return 'neutral'
    }
  }
  return 'running'
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) break
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

async function fetchReposRaw(): Promise<Omit<RepoMeta, 'latestRun'>[]> {
  const repos: Array<Omit<RepoMeta, 'latestRun'>> = []
  let page = 1
  for (;;) {
    const res = await ghFetch(`/user/repos?per_page=100&page=${page}&sort=updated`)
    if (!res.ok) throw new GitHubError(res.status, await res.text())
    const batch = (await res.json()) as Array<Record<string, unknown>>
    for (const r of batch) {
      repos.push({
        id: r.id as number,
        fullName: r.full_name as string,
        name: r.name as string,
        description: (r.description as string | null) ?? null,
        language: (r.language as string | null) ?? null,
        stars: (r.stargazers_count as number) ?? 0,
        forks: (r.forks_count as number) ?? 0,
        updatedAt: r.updated_at as string,
        pushedAt: (r.pushed_at as string) ?? '',
        defaultBranch: r.default_branch as string,
        visibility: r.visibility as string,
        archived: (r.archived as boolean) ?? false,
      })
    }
    if (batch.length < 100) break
    page++
    if (page > 30) break
  }
  return repos
}

export async function fetchWorkflowRuns(fullName: string, perPage = 10): Promise<WorkflowRunSummary[]> {
  const res = await ghFetch(`/repos/${fullName}/actions/runs?per_page=${perPage}`)
  if (res.status === 404) return []
  if (!res.ok) throw new GitHubError(res.status, await res.text())
  const data = (await res.json()) as { workflow_runs: Array<Record<string, unknown>> }
  return data.workflow_runs.map((r) => ({
    id: r.id as number,
    runNumber: r.run_number as number,
    workflowName: (r.name as string) ?? '',
    event: r.event as string,
    headBranch: (r.head_branch as string | null) ?? null,
    headSha: r.head_sha as string,
    status: mapRunStatus(r.status as string, (r.conclusion as string | null) ?? null),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    htmlUrl: r.html_url as string,
  }))
}

export async function fetchDashboard(): Promise<RepoMeta[]> {
  const repos = await fetchReposRaw()
  const latest = await mapWithConcurrency(repos, 8, async (r) => {
    try {
      const runs = await fetchWorkflowRuns(r.fullName, 1)
      return runs[0] ?? null
    } catch {
      return null
    }
  })
  return repos.map((r, i) => ({ ...r, latestRun: latest[i] }))
}

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
