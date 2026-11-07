/**
 * Minimal first-party RUM, no dependency and no personal data.
 * Metrics are aggregated on the server. Does not affect visitor/view counts.
 */
type Vital = 'LCP'|'FCP'|'INP'|'CLS'|'TTFB'
type Entry = PerformanceEntry & {
  value?: number
  hadRecentInput?: boolean
  interactionId?: number
  processingStart?: number
  responseStart?: number
  requestStart?: number
}
function pageKind(): 'landing'|'store'|'feed'|'panel'|'other' {
  const path=window.location.pathname
  if(path==='/')return 'landing'
  if(path.startsWith('/painel'))return 'panel'
  if(path.startsWith('/loja/') || path.startsWith('/l/'))return 'store'
  if(path.startsWith('/feed') || path.startsWith('/explorar'))return 'feed'
  return 'other'
}

export function startRealUserPerformanceMonitoring() {
  if (typeof PerformanceObserver==='undefined' || typeof navigator.sendBeacon!=='function')return
  const metrics=new Map<Vital,number>()
  const alreadySent=new Set<Vital>()
  const observers:PerformanceObserver[]=[]
  const observe=(type:string,callback:(entry:Entry)=>void)=>{
    try {
      const obs=new PerformanceObserver((list)=>{
        for(const entry of list.getEntries())callback(entry as Entry)
      })
      obs.observe({type,buffered:true})
      observers.push(obs)
    }catch{ /* Browser support is optional. */}
  }
  const navigation=performance.getEntriesByType('navigation')[0] as Entry|undefined
  if(navigation?.responseStart && navigation.responseStart >= navigation.requestStart!) {
    metrics.set('TTFB', navigation.responseStart-navigation.requestStart!)
  }
  observe('paint',entry=>{
    if(entry.name==='first-contentful-paint')metrics.set('FCP',entry.startTime)
  })
  observe('largest-contentful-paint',entry=>{
    metrics.set('LCP',entry.startTime)
  })
  let cls=0
  observe('layout-shift',entry=>{
    if (!entry.hadRecentInput) {
      cls+=Number(entry.value||0)
      metrics.set('CLS',Math.max(0,cls))
    }
  })
  let maxInp=0
  observe('event',entry=>{
    if(!entry.interactionId || !entry.duration)return
    maxInp=Math.max(maxInp,entry.duration)
    metrics.set('INP',maxInp)
  })
  const flush=()=>{
    for(const [metric,value] of metrics) {
      if(alreadySent.has(metric))continue
      alreadySent.add(metric)
      const payload=JSON.stringify({metric,value,page:pageKind()})
      navigator.sendBeacon('/api/public/rum',new Blob([payload],{type:'application/json'}))
    }
  }
  const hidden=()=>{if(document.visibilityState==='hidden')flush()}
  document.addEventListener('visibilitychange',hidden)
  window.addEventListener('pagehide',flush)
  // Clean up observers when leaving; only performance aggregates are sent.
  window.addEventListener('pagehide',()=>observers.forEach(o=>o.disconnect()),{once:true})
}
