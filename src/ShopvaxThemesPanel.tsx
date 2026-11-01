import { useEffect, useState } from 'react'
import { Check, CalendarDays, Clock3, Lightbulb, RotateCcw, Save, Sparkles } from 'lucide-react'
import { api } from './api'
import { SHOPVAX_PALETTES } from './ShopvaxDesignSystem'
import {
  SHOPVAX_DEFAULT_THEME, availableSeasonalThemes, seasonalThemeById, shopvaxMonthInBrazil,
  type ShopvaxSeasonalThemeId,
} from './shopvax-seasonal-themes'
import type { AdminBootstrap } from './types'
import './shopvax-themes-panel.css'

type Props = { data: AdminBootstrap; onSaved: () => void }

export default function ShopvaxThemesPanel({ data, onSaved }: Props) {
  const [brazilMonth, setBrazilMonth] = useState(() => shopvaxMonthInBrazil())
  // Mantém a interface atualizada na passagem de mês sem exigir que o lojista faça logout.
  useEffect(() => {
    const timer = window.setInterval(() => setBrazilMonth(shopvaxMonthInBrazil()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const now = new Date()
  const available = availableSeasonalThemes(now)
  const appliedSeasonRaw = String(data.store.seasonal_theme || 'padrao')
  const appliedSeason = seasonalThemeById(appliedSeasonRaw, now).id
  const appliedAccent = String(data.store.accent || '#F25C05')
  const [selectedSeason, setSelectedSeason] = useState<ShopvaxSeasonalThemeId>(appliedSeason)
  const [selectedAccent, setSelectedAccent] = useState(appliedAccent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  useEffect(() => {
    setSelectedSeason(appliedSeason)
    setSelectedAccent(appliedAccent)
  }, [appliedSeason, appliedAccent, data.store.id, brazilMonth])
  const theme = seasonalThemeById(selectedSeason, now)
  const effectiveSeason = theme.id
  const previewAccent = effectiveSeason === 'padrao' ? selectedAccent : theme.accent
  const modified = effectiveSeason !== appliedSeason || selectedAccent.toLowerCase() !== appliedAccent.toLowerCase()
    || (appliedSeasonRaw !== 'padrao' && appliedSeason === 'padrao')
  const expired = appliedSeasonRaw !== 'padrao' && appliedSeason === 'padrao'

  const save = async (season: ShopvaxSeasonalThemeId = effectiveSeason, accent = selectedAccent) => {
    const selected = seasonalThemeById(season, new Date()).id
    if (selected !== season) { setError('Essa campanha já terminou. Selecione o visual padrão.'); return }
    setBusy(true); setError(''); setSuccess('')
    try {
      await api.updateStore({ seasonalTheme: season, accent, completePaletteSetup: true })
      setSelectedSeason(season)
      setSelectedAccent(accent)
      setSuccess(season === 'padrao'
        ? 'Identidade padrão salva. Sua paleta personalizada foi mantida.'
        : 'Campanha aplicada à vitrine e ao próximo PDF até o fim do período.')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aplicar o tema.')
    } finally { setBusy(false) }
  }

  return <div className="panel-page svx-themes" aria-labelledby="svx-themes-title">
    <header className="page-title"><div><span>Identidade visual</span><h1 id="svx-themes-title">Temas e paletas</h1><p>Personalize sua loja sem alterar produtos, preços ou condições comerciais.</p></div></header>
    <div className="svx-themes__grid">
      <section className="svx-themes__picker" aria-label="Configurações de temas e paletas">
        <div className="svx-themes__intro"><h2>Paleta da sua marca</h2><p>Escolha uma cor principal. Ela será preservada quando uma campanha sazonal terminar.</p></div>
        <div className="svx-themes__palettes" role="group" aria-label="Paletas disponíveis">
          {SHOPVAX_PALETTES.map(palette => <button type="button" key={palette.id}
            aria-pressed={selectedAccent.toLowerCase() === palette.accent.toLowerCase()}
            className={selectedAccent.toLowerCase() === palette.accent.toLowerCase() ? 'is-selected' : ''}
            onClick={() => setSelectedAccent(palette.accent)}>
            <span className="svx-themes__swatch" style={{ background: palette.accent }} aria-hidden="true"/>
            <strong>{palette.label}</strong>
            {selectedAccent.toLowerCase() === palette.accent.toLowerCase() && <Check size={18} aria-hidden="true"/>}
          </button>)}
        </div>
        <label className="svx-themes__custom">Cor personalizada
          <input type="color" value={selectedAccent} onChange={event => setSelectedAccent(event.target.value)} aria-label="Cor personalizada da loja"/>
          <code>{selectedAccent.toUpperCase()}</code>
        </label>

        <div className="svx-themes__intro svx-themes__campaign-title">
          <div className="svx-themes__intro-heading"><h2>Temas sazonais</h2><span className="svx-themes__season-tag"><CalendarDays size={13}/> Por temporada</span></div>
          <p>Black Friday em novembro e Natal em dezembro. Cada tema aparece somente no mês da campanha e a loja retorna automaticamente ao visual normal depois.</p>
        </div>
        <div className="svx-themes__default-line">
          <button type="button" className={effectiveSeason === 'padrao' ? 'is-selected' : ''} aria-pressed={effectiveSeason === 'padrao'}
            onClick={() => { setSelectedSeason('padrao'); setError(''); setSuccess('') }}>
            <span className="svx-themes__default-icon"><Sparkles size={18}/></span>
            <span><strong>Identidade da loja</strong><small>Seu visual original, disponível o ano todo</small></span>
            {effectiveSeason === 'padrao' && <Check size={18}/>}
          </button>
        </div>

        {available.length ? <div className="svx-themes__seasons" role="group" aria-label="Temas sazonais">
          {available.map(item => <button type="button" key={item.id}
            data-season={item.id}
            className={effectiveSeason === item.id ? 'is-selected' : ''}
            aria-pressed={effectiveSeason === item.id}
            onClick={() => { setSelectedSeason(item.id); setError(''); setSuccess('') }}>
            <span className="svx-themes__mini" aria-hidden="true">
              <span className="svx-themes__mini-kicker">EDIÇÃO LIMITADA</span>
              <span className="svx-themes__mini-title">{item.headline}</span>
              <span className="svx-themes__mini-line"/>
              <span className="svx-themes__mini-folio">SHOPVAX / CATÁLOGO</span>
            </span>
            <span className="svx-themes__season-copy"><strong>{item.name}</strong><small>{item.period}</small></span>
            {effectiveSeason === item.id && <Check size={19}/>}
          </button>)}
        </div> : <div className="svx-themes__offseason" role="status">
          <Clock3 size={20} aria-hidden="true"/>
          <div><strong>Nenhuma campanha ativa neste mês</strong><p>Seu catálogo continua com a identidade normal. As opções Black Friday e Natal serão liberadas automaticamente nas respectivas temporadas.</p></div>
        </div>}
        {expired && <p className="svx-themes__expired" role="status">Sua campanha anterior terminou. A vitrine e os PDFs já usam o tema padrão; ao salvar você também limpa essa configuração antiga.</p>}
        <div className="svx-themes__tip"><div className="svx-themes__tip-heading"><Lightbulb size={17}/><strong>Dica para sua loja · {theme.name}</strong></div><p>{theme.tip}</p></div>
      </section>

      <aside className="svx-themes__preview" aria-label="Pré-visualização sem publicar">
        <div className="svx-themes__preview-bar"><span>PRÉ-VISUALIZAÇÃO</span><small>Não altera a loja antes de aplicar</small></div>
        <div className="svx-themes__sample" data-season={effectiveSeason} style={{
          '--theme-sample-bg': theme.background,
          '--theme-sample-accent': previewAccent,
          '--theme-sample-surface': theme.surface,
          '--theme-sample-ink': theme.ink,
          '--theme-sample-foreground': effectiveSeason === 'padrao' ? theme.ink : '#FFFFFF',
        } as React.CSSProperties}>
          <div className="svx-themes__sample-top"><span>{theme.decoration}</span><span>SHOPVAX · ATACADO</span></div>
          <div className="svx-themes__sample-hero">
            <span className="svx-themes__sample-kicker">{theme.headline}</span>
            <h3>{data.store.name}</h3>
            <p>{theme.message}</p>
            <span className="svx-themes__sample-cta">VER CATÁLOGO <span aria-hidden="true">↗</span></span>
            <span className="svx-themes__sample-art" aria-hidden="true"/>
          </div>
          <div className="svx-themes__sample-body">
            <div className="svx-themes__sample-section"><span>01 / VITRINE</span><strong>SELEÇÃO DA LOJA</strong></div>
            <div className="svx-themes__sample-product"><span>REFERÊNCIA 001</span><strong>Exemplo de produto</strong><em>Fotos, preços e estoque reais não são alterados.</em></div>
          </div>
          <div className="svx-themes__sample-footer">CATÁLOGO · GRADE · TALÃO <span>WHATSAPP ↗</span></div>
        </div>
        <p className="svx-themes__pdf-note">O tema aplicado vale para a vitrine e para os novos PDFs. Campanhas sazonais expiram automaticamente ao fim do mês, sem alterar sua paleta.</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        {success && <p role="status" className="svx-themes__success">{success}</p>}
        <div className="svx-themes__actions">
          <button type="button" className="svx-themes__restore" disabled={busy || (appliedSeasonRaw === 'padrao' && effectiveSeason === 'padrao')}
            onClick={() => { void save('padrao', selectedAccent) }}><RotateCcw size={16}/> Voltar ao visual padrão</button>
          <button type="button" className="primary-action" disabled={busy || !modified}
            onClick={() => { void save() }}>{busy ? 'Aplicando…' : 'Aplicar à loja'} <Save size={17}/></button>
        </div>
      </aside>
    </div>
  </div>
}
