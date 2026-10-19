import type { RunStatus } from '../api'

type BadgeStatus = RunStatus | 'none' | 'loading' | 'unknown'

const MAP: Record<BadgeStatus, { label: string; cls: string }> = {
  success: { label: '通过', cls: 'ok' },
  failure: { label: '失败', cls: 'fail' },
  running: { label: '运行中', cls: 'run' },
  neutral: { label: '跳过', cls: 'neutral' },
  attention: { label: '需操作', cls: 'attention' },
  none: { label: '无', cls: 'none' },
  loading: { label: '查询中', cls: 'neutral' },
  unknown: { label: '未获取', cls: 'none' },
}

export default function StatusBadge({ status }: { status: BadgeStatus }) {
  const m = MAP[status]
  return (
    <span className={`badge badge-${m.cls}`}>
      <span className={`dot ${m.cls === 'run' || status === 'loading' ? 'pulse' : ''}`} />
      {m.label}
    </span>
  )
}
