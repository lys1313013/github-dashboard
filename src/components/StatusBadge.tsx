import type { RunStatus } from '../api'

const MAP: Record<RunStatus | 'none', { label: string; cls: string }> = {
  success: { label: '通过', cls: 'ok' },
  failure: { label: '失败', cls: 'fail' },
  running: { label: '运行中', cls: 'run' },
  neutral: { label: '跳过', cls: 'neutral' },
  attention: { label: '需操作', cls: 'attention' },
  none: { label: '无', cls: 'none' },
}

export default function StatusBadge({ status }: { status: RunStatus | 'none' }) {
  const m = MAP[status]
  return (
    <span className={`badge badge-${m.cls}`}>
      <span className={`dot ${m.cls === 'run' ? 'pulse' : ''}`} />
      {m.label}
    </span>
  )
}
