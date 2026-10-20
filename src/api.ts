const BASE = 'https://api.github.com'
const TOKEN_KEY = 'github-dashboard.token'
const LEGACY_TOKEN_KEY = 'hubdeck.token'
const REQUEST_TIMEOUT_MS = 15_000
const DASHBOARD_CACHE_MS = 60_000
const ACTIONS_CONCURRENCY = 8
const MAX_FETCH_ATTEMPTS = 3

let dashboardCache: { token: string; repos: RepoMeta[]; updatedAt: number } | null = null

export type RunStatus = 'success' | 'failure' | 'running' | 'neutral' | 'attention'

export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token !== null) return token
  const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY)
  if (legacyToken !== null) {
    localStorage.setItem(TOKEN_KEY, legacyToken)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
  }
  return legacyToken
}

export function setToken(token: string): void {
  dashboardCache = null
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
}

export function clearToken(): void {
  dashboardCache = null
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
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
  workflowState: 'loading' | 'ready' | 'error'
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class GitHubNetworkError extends Error {
  constructor() {
    super('无法连接 GitHub API，已重试 2 次。请检查网络或代理后点击刷新。')
    this.name = 'GitHubNetworkError'
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return '连接 GitHub 超时，请检查网络或代理后重试。'
  }
  return error instanceof Error ? error.message : String(error)
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

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function ghFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const options = { headers: authHeaders(), signal: requestSignal }
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    requestSignal.throwIfAborted()
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, options)
    } catch (error) {
      requestSignal.throwIfAborted()
      // Fetch rejects with TypeError when no HTTP response is available (TLS,
      // a dropped connection, offline or CORS). Never retry explicit cancellation.
      if (!(error instanceof TypeError)) throw error
      if (attempt === MAX_FETCH_ATTEMPTS - 1) throw new GitHubNetworkError()
      await wait(500 * 2 ** attempt, requestSignal)
      continue
    }
    if (attempt === MAX_FETCH_ATTEMPTS - 1 || ![429, 502, 503, 504].includes(res.status)) {
      return res
    }
    const retryMs = res.status === 429
      ? (Number(res.headers.get('retry-after')) || 5) * 1000
      : 500 * 2 ** attempt
    await res.body?.cancel()
    await wait(retryMs, requestSignal)
  }
  throw new GitHubNetworkError()
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
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      signal?.throwIfAborted()
      const i = next++
      if (i >= items.length) break
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

type RepoMetadata = Omit<RepoMeta, 'latestRun' | 'workflowState'>

async function fetchReposRaw(
  onPage: (repos: RepoMetadata[]) => void,
  signal?: AbortSignal,
): Promise<RepoMetadata[]> {
  const repos: RepoMetadata[] = []
  let page = 1
  for (;;) {
    signal?.throwIfAborted()
    const res = await ghFetch(`/user/repos?per_page=100&page=${page}&sort=updated`, signal)
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
    onPage([...repos])
    if (batch.length < 100) break
    page++
    if (page > 30) break
  }
  return repos
}

export async function fetchWorkflowRuns(
  fullName: string,
  perPage = 10,
  signal?: AbortSignal,
): Promise<WorkflowRunSummary[]> {
  const res = await ghFetch(`/repos/${fullName}/actions/runs?per_page=${perPage}`, signal)
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

export function getCachedDashboard(): RepoMeta[] | null {
  return dashboardCache?.token === getToken() ? dashboardCache.repos : null
}

export async function fetchDashboard({
  onUpdate,
  signal,
  force = false,
}: {
  onUpdate?: (repos: RepoMeta[]) => void
  signal?: AbortSignal
  force?: boolean
} = {}): Promise<RepoMeta[]> {
  signal?.throwIfAborted()
  const token = getToken()
  if (!token) throw new GitHubError(401, '未配置 GitHub Token')
  const cached = dashboardCache?.token === token ? dashboardCache : null
  if (!force && cached && Date.now() - cached.updatedAt < DASHBOARD_CACHE_MS) {
    onUpdate?.(cached.repos)
    return cached.repos
  }

  const previous = new Map(cached?.repos.map((repo) => [repo.id, repo]))
  let repos: RepoMeta[] = []
  const publish = () => {
    signal?.throwIfAborted()
    if (getToken() !== token) throw new DOMException('Token 已更换', 'AbortError')
    // Keep partial results on navigation, but only mark a full refresh as fresh.
    dashboardCache = { token, repos: [...repos], updatedAt: 0 }
    onUpdate?.(dashboardCache.repos)
  }

  await fetchReposRaw((metadata) => {
    repos = metadata.map((repo) => ({
      ...repo,
      latestRun: previous.get(repo.id)?.latestRun ?? null,
      workflowState: 'loading',
    }))
    publish()
  }, signal)

  await mapWithConcurrency(repos, ACTIONS_CONCURRENCY, async (repo) => {
    let updated: RepoMeta
    try {
      const runs = await fetchWorkflowRuns(repo.fullName, 1, signal)
      updated = { ...repo, latestRun: runs[0] ?? null, workflowState: 'ready' }
    } catch {
      signal?.throwIfAborted()
      updated = { ...repo, workflowState: 'error' }
    }
    repos = repos.map((item) => item.id === updated.id ? updated : item)
    publish()
  }, signal)

  signal?.throwIfAborted()
  if (getToken() === token) {
    const complete = repos.every((repo) => repo.workflowState === 'ready')
    dashboardCache = { token, repos, updatedAt: complete ? Date.now() : 0 }
  }
  return repos
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
