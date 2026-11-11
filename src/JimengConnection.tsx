import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Clipboard, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react'
import { beginJimengLogin, checkJimengAccount, listJimengModels, openJimengLogin, runJimengCli, type JimengChallenge } from './jimengCli'
import { isDesktopApp } from './providerTransport'
import type { RemoteModel } from './imageApi'

const installation = 'https://jimeng.jianying.com/ai-tool/install'

export function JimengConnection({ onModels, onAvailability }: {
  onModels: (models: RemoteModel[]) => void
  onAvailability: (authorized: boolean) => void
}) {
  const [phase, setPhase] = useState<'checking' | 'missing' | 'idle' | 'starting' | 'waiting' | 'ready'>('checking')
  const [challenge, setChallenge] = useState<JimengChallenge>()
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const callbacks = useRef({ onModels, onAvailability })
  useEffect(() => { callbacks.current = { onModels, onAvailability } }, [onModels, onAvailability])
  const active = useRef(false)
  const lookup = async () => {
    setNotice('')
    setPhase('checking')
    try {
      await checkJimengAccount()
      if (!active.current) return
      setPhase('ready')
      callbacks.current.onAvailability(true)
      const models = await listJimengModels()
      if (active.current) callbacks.current.onModels(models)
    } catch (error) {
      if (!active.current) return
      const message = error instanceof Error ? error.message : '即梦连接暂时不可用'
      const missing = message.includes('没有找到')
      setPhase(missing ? 'missing' : 'idle')
      callbacks.current.onAvailability(false)
      if (missing || !message.includes('请先登录')) setNotice(message)
    }
  }

  useEffect(() => {
    active.current = true
    if (isDesktopApp()) void lookup()
    return () => { active.current = false }
  }, [])

  useEffect(() => {
    if (!challenge) return
    let cancelled = false
    let timer: number | undefined
    const end = Date.now() + 5 * 60_000
    const poll = async () => {
      try {
        await runJimengCli('finish', { id: challenge.deviceCode })
        await checkJimengAccount()
        if (cancelled) return
        setChallenge(undefined)
        void lookup()
        return
      } catch { /* Approval may still be pending. The local CLI owns the OAuth session. */ }
      if (cancelled) return
      if (Date.now() >= end) {
        setChallenge(undefined)
        setPhase('idle')
        setNotice('授权已超时，请重新获取验证码。')
      } else timer = window.setTimeout(poll, 2600)
    }
    timer = window.setTimeout(poll, 900)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [challenge])

  const start = async (relogin: boolean) => {
    setPhase('starting')
    setNotice('')
    setCopied(false)
    callbacks.current.onAvailability(false)
    try {
      const next = await beginJimengLogin(relogin)
      if (!active.current) return
      if (!next) { void lookup(); return }
      setChallenge(next)
      setPhase('waiting')
    } catch (error) {
      if (!active.current) return
      const message = error instanceof Error ? error.message : '无法启动即梦授权'
      setPhase(message.includes('没有找到') ? 'missing' : 'idle')
      setNotice(message)
    }
  }

  const open = async () => {
    if (!challenge) return
    try { await openJimengLogin(challenge.url) } catch (error) { setNotice((error as Error).message) }
  }

  if (!isDesktopApp()) return <section className="jimeng-connection">
    <div><KeyRound size={17} /><span><strong>在 Disy 桌面版登录即梦</strong><small>桌面版通过即梦官方 CLI 连接你的账号，并使用该账号的创作额度。</small></span></div>
    <a href={installation} target="_blank" rel="noopener noreferrer">查看官方安装说明 <ArrowUpRight size={14} /></a>
  </section>

  return <section className="jimeng-connection" aria-label="即梦官方账号">
    <div><span className="jimeng-account-icon">{phase === 'ready' ? <Check size={17} /> : <KeyRound size={17} />}</span><span>
      <strong>{phase === 'ready' ? '即梦账号已授权' : phase === 'missing' ? '先安装即梦创作 CLI' : '即梦账号授权'}</strong>
      <small>{phase === 'ready' ? '授权由官方 CLI 保存在本机。模型和额度以即梦账号为准。' : '在即梦官网授权后，返回这里启用图片和视频模型。'}</small>
    </span></div>
    {phase === 'missing' && <div className="jimeng-connection-actions">
      <a href={installation} target="_blank" rel="noopener noreferrer">安装官方 CLI <ArrowUpRight size={14} /></a>
      <button type="button" onClick={() => void lookup()}><RefreshCw size={13} />重新检测</button>
    </div>}
    {(phase === 'idle' || phase === 'ready') && <div className="jimeng-connection-actions">
      <button type="button" onClick={() => void start(phase === 'ready')}><KeyRound size={14} />{phase === 'ready' ? '重新授权' : '登录即梦'}</button>
      {phase === 'ready' && <button type="button" onClick={() => void lookup()}><RefreshCw size={13} />刷新模型</button>}
    </div>}
    {(phase === 'checking' || phase === 'starting') && <p role="status"><LoaderCircle className="is-spinning" size={14} />{phase === 'checking' ? '正在检查即梦账号' : '正在获取验证码'}</p>}
    {challenge && <div className="jimeng-device-flow">
      <div><span>1</span><strong>打开即梦官网</strong><button type="button" onClick={() => void open()}>打开授权页 <ArrowUpRight size={14} /></button></div>
      <div><span>2</span><strong>输入验证码</strong><code>{challenge.userCode}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(challenge.userCode).then(() => setCopied(true)).catch(() => setNotice('可选中验证码并手动复制。')) }}><Clipboard size={13} />{copied ? '已复制' : '复制'}</button></div>
      <p role="status"><LoaderCircle className="is-spinning" size={14} />正在等待官网授权 <button type="button" onClick={() => { setChallenge(undefined); setPhase('idle') }}>取消</button></p>
    </div>}
    {notice && <p className="jimeng-connection-notice" role="status">{notice}</p>}
  </section>
}
