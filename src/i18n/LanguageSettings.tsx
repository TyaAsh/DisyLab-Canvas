import { Check, Globe2 } from 'lucide-react'
import { LANGUAGES, setLocale } from './core'
import { OriginalText, useLocale } from './react'

export function LanguageSettings() {
  const locale = useLocale()
  return <section className="language-settings-panel" aria-labelledby="language-settings-title">
    <header><Globe2 size={20} aria-hidden="true"/><div><h3 id="language-settings-title">语言与显示</h3><p>选择界面语言，切换后立即生效。</p></div></header>
    <fieldset><legend>界面语言</legend><div className="language-options">
      {LANGUAGES.map(language => <label key={language.value} className={locale === language.value ? 'is-selected' : ''}>
        <input type="radio" name="interface-language" value={language.value} checked={locale === language.value} onChange={() => setLocale(language.value)} />
        <span><strong><OriginalText>{language.label}</OriginalText></strong><small>{language.detail}</small></span>
        {locale === language.value && <Check size={17} aria-hidden="true"/>}
      </label>)}
    </div></fieldset>
    <p className="language-settings-note">语言偏好会保存在此设备。项目名称、提示词、对话内容和厂商原始返回保持原样。</p>
  </section>
}
