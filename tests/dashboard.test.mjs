import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { beforeEach, test } from 'node:test'
import ts from 'typescript'

// Exercise the real API implementation without a browser, credentials or network.
const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const api = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
beforeEach(() => api.setToken('synthetic-token'))

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function metadata(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: offset + index,
    full_name: `test/repo-${offset + index}`,
    name: `repo-${offset + index}`,
    updated_at: '2026-10-19T00:00:00Z',
    pushed_at: '2026-10-19T00:00:00Z',
  }))
}

function runs() {
  return Response.json({ workflow_runs: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'success' }] })
}

test('publishes cards before Actions finish, streams results and limits concurrency to 8', async (t) => {
  const first = deferred()
  const rest = deferred()
  const updates = []
  let active = 0, peak = 0, started = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (new URL(url).pathname === '/user/repos') return Response.json(metadata(17))
    active++
    started++
    peak = Math.max(peak, active)
    await (url.includes('/repo-0/') ? first.promise : rest.promise)
    active--
    return runs()
  })
  const pending = api.fetchDashboard({ onUpdate: (repos) => updates.push(repos) })
  await setImmediate()
  assert.equal(updates[0].length, 17)
  assert.ok(updates[0].every((repo) => repo.workflowState === 'loading'))
  assert.equal(started, 8)
  first.resolve()
  await setImmediate()
  assert.equal(updates.at(-1).filter((repo) => repo.workflowState === 'ready').length, 1)
  assert.equal(started, 9)
  rest.resolve()
  const result = await pending
  assert.equal(peak, 8)
  assert.equal(started, 17)
  assert.ok(result.every((repo) => repo.latestRun.status === 'success'))
  assert.ok(updates[0].every((repo) => repo.workflowState === 'loading'), 'previous snapshots stay immutable')
})

test('publishes the first repository page before later pages arrive', async (t) => {
  const secondPage = deferred()
  const updates = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname !== '/user/repos') return runs()
    if (parsed.searchParams.get('page') === '1') return Response.json(metadata(100))
    await secondPage.promise
    return Response.json(metadata(1, 100))
  })
  const pending = api.fetchDashboard({ onUpdate: (repos) => updates.push(repos) })
  await setImmediate()
  assert.equal(updates[0].length, 100)
  secondPage.resolve()
  assert.equal((await pending).length, 101)
})

test('reuses fresh cache, supports forced refresh and clears cache when switching tokens', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests++
    return new URL(url).pathname === '/user/repos' ? Response.json(metadata(1)) : runs()
  })
  const initial = await api.fetchDashboard()
  assert.equal(requests, 2)
  assert.deepEqual(api.getCachedDashboard(), initial)
  await api.fetchDashboard()
  assert.equal(requests, 2)
  await api.fetchDashboard({ force: true })
  assert.equal(requests, 4)
  api.setToken('another-synthetic-token')
  assert.equal(api.getCachedDashboard(), null)
  await api.fetchDashboard()
  assert.equal(requests, 6)
  api.clearToken()
  assert.equal(api.getCachedDashboard(), null)
})

test('isolates failed Actions requests and distinguishes failure from no runs', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests++
    if (new URL(url).pathname === '/user/repos') return Response.json(metadata(3))
    if (url.includes('/repo-0/')) return new Response('Forbidden', { status: 403 })
    if (url.includes('/repo-1/')) return new Response(null, { status: 404 })
    return runs()
  })
  const result = await api.fetchDashboard()
  assert.deepEqual(result.map((repo) => repo.workflowState), ['error', 'ready', 'ready'])
  assert.equal(result[1].latestRun, null)
  assert.equal(result[2].latestRun.status, 'success')
  await api.fetchDashboard()
  assert.equal(requests, 8, 'partial failures should be retried rather than cached as fresh')
})

test('cancels active requests and never starts queued work after leaving the page', async (t) => {
  const controller = new AbortController()
  let actions = 0, updates = 0, aborted = 0
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    signal.throwIfAborted()
    if (new URL(url).pathname === '/user/repos') return Response.json(metadata(20))
    actions++
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      aborted++
      reject(signal.reason)
    }, { once: true }))
  })
  const pending = api.fetchDashboard({ signal: controller.signal, onUpdate: () => { updates++ } })
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  await setImmediate()
  controller.abort()
  await rejection
  await setImmediate()
  assert.equal(actions, 8)
  assert.equal(aborted, 8)
  assert.equal(updates, 1)
})

test('times out a stalled Actions request while preserving visible metadata', async (t) => {
  const deadline = new AbortController()
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    assert.equal(ms, 15_000)
    return deadline.signal
  })
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    if (new URL(url).pathname === '/user/repos') return Response.json(metadata(1))
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const pending = api.fetchDashboard()
  await setImmediate()
  assert.equal(api.getCachedDashboard()[0].workflowState, 'loading')
  deadline.abort(new DOMException('Request timed out', 'TimeoutError'))
  const result = await pending
  assert.equal(result.length, 1)
  assert.equal(result[0].workflowState, 'error')
})

test('cancels a rate-limit retry wait without retrying the request', async (t) => {
  const controller = new AbortController()
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return new Response(null, { status: 429, headers: { 'retry-after': '120' } })
  })
  const pending = api.fetchDashboard({ signal: controller.signal })
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  await setImmediate()
  controller.abort()
  await rejection
  assert.equal(requests, 1)
})

test('recovers from a transient connection failure with exponential backoff', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    if (requests < 3) throw new TypeError('Failed to fetch')
    return runs()
  })
  const pending = api.fetchWorkflowRuns('test/repo')
  await setImmediate()
  assert.equal(requests, 1)
  t.mock.timers.tick(500)
  await setImmediate()
  assert.equal(requests, 2)
  t.mock.timers.tick(1000)
  assert.equal((await pending)[0].status, 'success')
  assert.equal(requests, 3)
})

test('reports a useful network error after exactly three unsuccessful attempts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    throw new TypeError('Failed to fetch')
  })
  const pending = api.fetchDashboard()
  const rejection = assert.rejects(pending, (error) => {
    assert.equal(error.name, 'GitHubNetworkError')
    assert.match(error.message, /无法连接 GitHub API/)
    return true
  })
  await setImmediate()
  t.mock.timers.tick(500)
  await setImmediate()
  t.mock.timers.tick(1000)
  await rejection
  assert.equal(requests, 3)
})

test('does not retry invalid credentials', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return new Response('Bad credentials', { status: 401 })
  })
  await assert.rejects(api.fetchDashboard(), { status: 401 })
  assert.equal(requests, 1)
})

test('cancels network backoff immediately when navigating away', async (t) => {
  const controller = new AbortController()
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    throw new TypeError('Failed to fetch')
  })
  const pending = api.fetchDashboard({ signal: controller.signal })
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  await setImmediate()
  controller.abort()
  await rejection
  assert.equal(requests, 1)
})
