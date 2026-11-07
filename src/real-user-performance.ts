import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'

/** Privacy-minimal first-party Real User Monitoring.
 * Official Web Vitals calculation avoids overstating CLS or treating max event
 * duration as INP. No full URL, cookie, identifier or user agent is transmitted.
 */
function pageKind(): 'landing'|'store'|'feed'|'panel'|'other' {
  const path=window.location.pathname
  if(path==='/')return 'landing'
  if(path.startsWith('/painel'))return 'panel'
  if(path.startsWith('/loja/') || path.startsWith('/l/') || path.startsWith('/perfil/'))return 'store'
  if(path.startsWith('/feed') || path.startsWith('/descobrir'))return 'feed'
  return 'other'
}

export function startRealUserPerformanceMonitoring() {
  if (typeof navigator.sendBeacon!=='function') return
  const reported=new Set<string>()
  const report=(metric:Metric)=>{
    // Each Core Web Vital is reported once per navigation, at its final value.
    if(reported.has(metric.name))return
    reported.add(metric.name)
    const payload=JSON.stringify({
      metric:metric.name,
      value:metric.value,
      page:pageKind(),
    })
    navigator.sendBeacon('/api/public/rum',new Blob([payload],{type:'application/json'}))
  }
  onCLS(report)
  onFCP(report)
  onINP(report)
  onLCP(report)
  onTTFB(report)
}
