import { useState } from 'react'
import { clearToken, getToken, setToken } from './api'
import RepoList from './views/RepoList'
import RepoDetail from './views/RepoDetail'
import TokenSetup from './components/TokenSetup'

type View = { type: 'list' } | { type: 'detail'; owner: string; repo: string }

export default function App() {
  const [view, setView] = useState<View>({ type: 'list' })
  const [token, setTokenState] = useState<string | null>(() => getToken())

  if (!token) {
    return (
      <TokenSetup
        onSave={(t) => {
          setToken(t)
          setTokenState(t)
          setView({ type: 'list' })
        }}
      />
    )
  }

  if (view.type === 'list') {
    return (
      <RepoList
        onSelect={(fullName) => {
          const [owner, repo] = fullName.split('/')
          setView({ type: 'detail', owner, repo })
        }}
        onLogout={() => {
          clearToken()
          setTokenState(null)
        }}
      />
    )
  }

  return <RepoDetail owner={view.owner} repo={view.repo} onBack={() => setView({ type: 'list' })} />
}
