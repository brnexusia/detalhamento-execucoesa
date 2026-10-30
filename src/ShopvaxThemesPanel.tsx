import { useEffect, useState } from 'react'
import { Check, RotateCcw, Save } from 'lucide-react'
import { api } from './api'
import { SHOPVAX_PALETTES } from './ShopvaxDesignSystem'
import { SHOPVAX_SEASONAL_THEMES, seasonalThemeById, type ShopvaxSeasonalThemeId } from './shopvax-seasonal-themes'
import type { AdminBootstrap } from './types'
import './shopvax-themes-panel.css'

type Props = {
  data: AdminBootstrap
  onSaved: () => void
}
export default function ShopvaxThemesPanel({ data, onSaved }: Props) {
  const appliedSeason = String(data.store.seasonal_theme || 'padrao') as ShopvaxSeasonalThemeId
  const appliedAccent = String(data.store.accent || '#F25C05')
  const [selectedSeason, setSelectedSeason] = useState<ShopvaxSeasonalThemeId>(appliedSeason)
  const [selectedAccent, setSelectedAccent] = useState(appliedAccent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showTip, setShowTip] = useState(true)
  useEffect(() => { setSelectedSeason(appliedSeason); setSelectedAccent(appliedAccent) }, [appliedSeason, appliedAccent, data.store.id])
  const theme = seasonalThemeById(selectedSeason)
  const previewAccent = selectedSeason === 'padrao' ? selectedAccent : theme.accent
  const modified = selectedSeason !== appliedSeason || selectedAccent.toLowerCase() !== appliedAccent.toLowerCase()

  const save = async (season = selectedSeason, accent = selectedAccent) => {
    setBusy(true); setError(''); setSuccess('')
    try {
      await api.updateStore({ seasonalTheme: season, accent, completePaletteSetup: true })
      setSelectedSeason(season)
      setSelectedAccent(accent)
      setSuccess('Identidade aplicada à loja. O próximo PDF usará este visual.')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aplicar a identidade.')
    } finally { setBusy(false) }
  }

  return <div className="panel-page svx-themes" aria-labelledby="svx-themes-title">
    <header className="page-title"><div><span>Identidade visual</span><h1 id="svx-themes-title">Temas e paletas</h1><p>Personalize cores, textos e fundos da vitrine e do PDF do catálogo.</p></div></header>
    <div className="svx-themes__grid">
      <section className="svx-themes__picker" aria-label="Configurações de temas e paletas">
        <div className="svx-themes__intro">
          <h2>Paletas de cores</h2>
          <p>Escolha as cores da sua marca. A paleta fica salva quando você clicar em aplicar.</p>
        </div>
        <div className="svx-themes__palettes" role="group" aria-label="Paletas disponíveis">
          {SHOPVAX_PALETTES.map(palette => <button type="button" key={palette.id}
            aria-pressed={selectedAccent.toLowerCase() === palette.accent.toLowerCase()}
            className={selectedAccent.toLowerCase() === palette.accent.toLowerCase() ? 'is-selected' : ''}
            onClick={() => setSelectedAccent(palette.accent)}>
            <span className="svx-themes__swatch" style={{ background: palette.accent }} aria-hidden="true"/>
            <strong>{palette.label}</strong>
            {selectedAccent.toLowerCase() === palette.accent.toLowerCase() && <Check size={18}/>}
          </button>)}
        </div>
        <label className="svx-themes__custom">Cor personalizada
          <input type="color" value={selectedAccent} onChange={event => setSelectedAccent(event.target.value)} aria-label="Cor personalizada da loja"/>
          <code>{selectedAccent.toUpperCase()}</code>
        </label>

        <div className="svx-themes__intro">
          <h2>Temas sazonais</h2>
          <p>São identidades completas: alteram fundos, textos, fita e detalhes gráficos — não só a cor.</p>
        </div>
        <div className="svx-themes__seasons" role="group" aria-label="Temas sazonais">
          {SHOPVAX_SEASONAL_THEMES.map(item => <button type="button" key={item.id}
            className={selectedSeason === item.id ? 'is-selected' : ''}
            aria-pressed={selectedSeason === item.id}
            onClick={() => { setSelectedSeason(item.id); setShowTip(true) }}>
            <span className="svx-themes__mini" aria-hidden="true" style={{ background:item.background,color:item.id === 'padrao' ? item.ink : '#fff',borderColor:item.accent }}>
              <span>{item.headline}</span><i style={{background:item.accent}}/>
            </span>
            <span className="svx-themes__season-copy"><strong>{item.name}</strong><small>{item.message}</small></span>
            {selectedSeason === item.id && <Check size={18}/>}
          </button>)}
        </div>
        {showTip && <div className="svx-themes__tip"><strong>Dica · {theme.name}</strong><p>{theme.tip}</p></div>}
      </section>

      <aside className="svx-themes__preview" aria-label="Pré-visualização sem publicar">
        <div className="svx-themes__preview-bar"><span>PRÉ-VISUALIZAÇÃO</span><small>Não altera a loja antes de aplicar</small></div>
        <div className="svx-themes__sample" style={{
          '--theme-sample-bg': theme.background,
          '--theme-sample-accent': previewAccent,
          '--theme-sample-surface': theme.surface,
          '--theme-sample-ink': theme.ink,
          '--theme-sample-foreground': theme.id === 'padrao' ? theme.ink : '#FFFFFF',
        } as React.CSSProperties}>
          <div className="svx-themes__sample-top"><span>{theme.decoration}</span><span>{theme.decoration}</span></div>
          <div className="svx-themes__sample-body">
            <small>{theme.headline}</small>
            <h3>{data.store.name}</h3>
            <p>{theme.message}</p>
            <div className="svx-themes__sample-product"><span>REFERÊNCIA 001</span><strong>Exemplo de produto</strong><em>As informações reais são preservadas.</em></div>
          </div>
          <div className="svx-themes__sample-footer">CATÁLOGO · GRADE · TALÃO</div>
        </div>
        <p className="svx-themes__pdf-note">Ao clicar em <strong>Gerar PDF</strong>, o arquivo usa a paleta ou o tema <strong>já aplicado</strong> à loja. Esta prévia não altera o PDF.</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        {success && <p role="status" className="svx-themes__success">{success}</p>}
        <div className="svx-themes__actions">
          <button type="button" className="svx-themes__restore" disabled={busy || (appliedSeason === 'padrao' && selectedSeason === 'padrao')}
            onClick={() => { void save('padrao', selectedAccent) }}><RotateCcw size={16}/> Voltar ao tema padrão</button>
          <button type="button" className="primary-action" disabled={busy || !modified}
            onClick={() => { void save() }}>{busy ? 'Aplicando…' : 'Aplicar à loja'} <Save size={17}/></button>
        </div>
      </aside>
    </div>
  </div>
}
