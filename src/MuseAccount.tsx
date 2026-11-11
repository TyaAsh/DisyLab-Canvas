import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react'
import { isDesktopApp } from './providerTransport'
import { checkMuseWebAccount, MUSE_WEB_MODELS } from './museWeb'

export function MuseAccount({ onAvailability }: { onAvailability: (ready: boolean) => void }) {
  const [opening, setOpening] = useState(false)
  const [checking, setChecking] = useState(false)
  const [ready, setReady] = useState(false)
  const [awaitingLogin, setAwaitingLogin] = useState(false)
  const [notice, setNotice] = useState('')
  const checkingRef = useRef(false)
  const mounted = useRef(false)
  const availability = useRef(onAvailability)
  availability.current = onAvailability
  const desktop = isDesktopApp()

  async function refresh(showError = true) {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    try {
      await checkMuseWebAccount()
      if (!mounted.current) return
      setReady(true)
      setNotice('')
      setAwaitingLogin(false)
      availability.current(true)
    } catch (error) {
      if (!mounted.current) return
      setReady(false)
      availability.current(false)
      if (showError) setNotice(error instanceof Error ? error.message : 'Muse 登录状态验证失败。')
    } finally {
      checkingRef.current = false
      if (mounted.current) setChecking(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    if (desktop) void refresh(false)
    return () => { mounted.current = false }
  }, [desktop])

  useEffect(() => {
    if (!awaitingLogin) return
    const onFocus = () => { void refresh(false) }
    const timer = window.setInterval(onFocus, 4500)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [awaitingLogin])

  const open = async () => {
    setOpening(true)
    setNotice('')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('muse_open_account', { inBrowser: false })
      setAwaitingLogin(true)
    } catch (error) {
      setNotice(typeof error === 'string' ? error : '无法打开 Muse 登录窗口。')
    } finally {
      setOpening(false)
    }
  }
  return <section className="jimeng-connection muse-account-card" aria-label="Muse 账号登录">
    <div><span className="jimeng-account-icon"><KeyRound size={17} /></span><span>
      <strong>{ready ? 'Muse 已连接' : '登录 Muse 账号'}</strong>
      <small>{desktop ? '在弹出的 Muse 官网窗口登录。连接后可启用对话、图片和视频。' : '请在 Windows 桌面版连接 Muse 账号。'}</small>
    </span></div>
    <div className="jimeng-connection-actions">
      {desktop ? <>
        <button type="button" disabled={opening} onClick={() => void open()}>{opening ? <LoaderCircle size={14} className="is-spinning" /> : <ArrowUpRight size={14} />}{ready ? '打开 Muse 窗口' : '登录 Muse'}</button>
        <button type="button" disabled={checking} onClick={() => void refresh()}>{checking ? <LoaderCircle size={14} className="is-spinning" /> : <RefreshCw size={14} />}刷新登录状态</button>
      </> : <a href="https://muse.ai/" target="_blank" rel="noopener noreferrer">前往 Muse 官网 <ArrowUpRight size={14} /></a>}
    </div>
    {awaitingLogin && <p role="status">正在等待 Muse 登录。进入对话页后，画布会自动更新状态。</p>}
    {ready && <p>{MUSE_WEB_MODELS.map((model) => model.name).join(' · ')}。生成能力以你的 Muse 账号为准。</p>}
    {notice && <p className="jimeng-connection-notice" role="status">{notice}</p>}
  </section>
}
