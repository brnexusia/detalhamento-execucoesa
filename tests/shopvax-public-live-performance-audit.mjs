import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

/**
 * Public production performance sampling. READ ONLY. Does not sign in, place orders,
 * modify account data, or claim that login-gated panel content was measured.
 * Single-run lab snapshots, NOT CrUX/field data or representative percentiles.
 */
const origin = process.env.AUDIT_ORIGIN || 'https://shopvax.com.br'
const storeSlug = process.env.AUDIT_STORE_SLUG || 'sw-moda-feminina'
const routes = [
  ['feed-home', '/'],
  ['feed-alias', '/feed'],
  ['landing', '/para-lojas'],
  ['login', '/entrar'],
  ['register', '/criar-conta'],
  ['buyer', '/comprador'],
  ['partners', '/parceiros'],
  ['store', '/' + storeSlug],
  ['profile', '/perfil/' + storeSlug],
  ['customer', '/cliente/' + storeSlug],
  ['panel-home-unauthenticated', '/painel'],
  ['panel-products-unauthenticated', '/painel/produtos'],
  ['admin-unauthenticated', '/admin'],
]
const configurations = [
  { id:'desktop-4g', width:1366, height:768, latency:150, down:4_000_000, up:1_000_000, cpu:4 },
  { id:'mobile-slow3g', width:390, height:844, latency:400, down:400_000, up:150_000, cpu:4 },
]
const num = (v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : null
const out = []
const browser = await chromium.launch({headless:true, args:['--no-sandbox']})

try {
  for (const config of configurations) {
    for (const [name, pathname] of routes) {
      const context = await browser.newContext({
        viewport:{width:config.width,height:config.height},
        deviceScaleFactor:config.width < 600 ? 2 : 1,
        isMobile:config.width < 600,
        hasTouch:config.width < 600,
        serviceWorkers:'block',
      })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      const requestErrors=[]
      const httpErrors=[]
      const started=Date.now()
      let pageStatus=null
      let navigationError=null

      await page.addInitScript(() => {
        window.__auditVitals = {lcp:null,cls:0,longTasks:0,longTaskMs:0}
        if (!('PerformanceObserver' in window)) return
        for (const [entryType, handler] of [
          ['largest-contentful-paint',(entry) => {window.__auditVitals.lcp=entry.startTime}],
          ['layout-shift',(entry) => {if(!entry.hadRecentInput) window.__auditVitals.cls+=entry.value}],
          ['longtask',(entry) => {window.__auditVitals.longTasks++;window.__auditVitals.longTaskMs+=entry.duration}],
        ]) {
          try {new PerformanceObserver((entries) => entries.getEntries().forEach(handler)).observe({type:entryType,buffered:true})} catch {}
        }
      })
      // Prevent analytics/commerce mutations. Public page GETs still work normally.
      await page.route('**/*', route => {
        const req=route.request()
        return ['GET','HEAD','OPTIONS'].includes(req.method())
          ? route.continue()
          : route.fulfill({status:204,body:''})
      })
      page.on('requestfailed',req => {
        if (requestErrors.length < 8) requestErrors.push({method:req.method(),path:new URL(req.url()).pathname,error:req.failure()?.errorText||'failed'})
      })
      page.on('response',r => {
        if (r.status()<400 || httpErrors.length>=8) return
        const u=new URL(r.url())
        if (u.origin===origin) httpErrors.push({status:r.status(),path:u.pathname})
      })
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions',{
        offline:false,latency:config.latency,
        downloadThroughput:config.down/8,uploadThroughput:config.up/8
      })
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:config.cpu})
      try {
        const response=await page.goto(origin+pathname,{waitUntil:'domcontentloaded',timeout:45000})
        pageStatus=response?.status()??null
        await page.waitForTimeout(config.width<600?4500:2500)
      } catch(error) {navigationError=String(error?.message||error).slice(0,240)}

      let metrics=null
      try {
        metrics=await page.evaluate(() => {
          const nav=performance.getEntriesByType('navigation')[0]
          const resources=performance.getEntriesByType('resource')
          const paints=performance.getEntriesByType('paint')
          const fcp=paints.find(x=>x.name==='first-contentful-paint')
          const v=window.__auditVitals||{}
          const totals={}
          for(const r of resources) {
            const type=r.initiatorType || 'other'
            if(!totals[type]) totals[type]={count:0,transferBytes:0}
            totals[type].count++
            totals[type].transferBytes+=r.transferSize||0
          }
          return {
            path:location.pathname,
            title:document.title,
            bodyCharacters:(document.body?.innerText||'').length,
            domElements:document.querySelectorAll('*').length,
            ttfbMs:nav ? nav.responseStart-nav.requestStart : null,
            dclMs:nav?.domContentLoadedEventEnd ?? null,
            loadMs:nav?.loadEventEnd ?? null,
            fcpMs:fcp?.startTime ?? null,
            lcpMs:v.lcp ?? null,cls:v.cls ?? null,
            longTasks:v.longTasks||0,longTaskMs:v.longTaskMs||0,
            transferredBytes:(resources.reduce((sum,r)=>sum+(r.transferSize||0),0)+(nav?.transferSize||0)),
            resourceCount:resources.length,byType:totals,
            imageCount:document.images.length,
            contentType:document.querySelector('.store-intro.svx-vitrine')?'store':
              document.querySelector('.social-feed-card')?'feed':
              document.querySelector('.panel-shell')?'panel':
              document.querySelector('.auth-shell')?'auth':'other'
          }
        })
      } catch(error) {navigationError=(navigationError||'')+' metrics: '+String(error).slice(0,150)}
      const gated=/^\/(?:painel|admin)/.test(pathname)
      const result={
        route:name,requestedPath:pathname,profile:config.id,
        status:pageStatus,
        elapsedMs:Date.now()-started,
        gatedPage:gated,
        navigationError,requestErrors,httpErrors,
        ...metrics,
      }
      if(result.ttfbMs!=null) result.ttfbMs=num(result.ttfbMs)
      if(result.fcpMs!=null) result.fcpMs=num(result.fcpMs)
      if(result.lcpMs!=null) result.lcpMs=num(result.lcpMs)
      if(result.dclMs!=null) result.dclMs=num(result.dclMs)
      if(result.loadMs!=null) result.loadMs=num(result.loadMs)
      if(result.cls!=null) result.cls=num(result.cls)
      if(result.longTaskMs!=null) result.longTaskMs=num(result.longTaskMs)
      out.push(result)
      console.log('SHOPVAX_PERF_ROUTE '+JSON.stringify(result))
      await context.close()
    }
  }
} finally {await browser.close()}

mkdirSync('artifacts/shopvax-performance-audit',{recursive:true})
const path='artifacts/shopvax-performance-audit/public-pages.json'
writeFileSync(path,JSON.stringify({
  origin,storeSlug,runAt:new Date().toISOString(),
  environment:'GitHub Actions Ubuntu, Playwright Chromium, read-only, first navigation per fresh context, simulated desktop 4G/mobile slow3G, CPU 4x; not a field metric or p75',
  limitations:'Authenticated panel contents not measured. Only unauthenticated landing/redirect. One sample per route/profile; no p75/p95 claim. Third-party transferSize may be zero by cross-origin restrictions. Capped observation window, LCP may be incomplete.',
  results:out
},null,2))
console.log('SHOPVAX_PERF_AUDIT_SUMMARY '+JSON.stringify({routes:routes.length,profiles:configurations.length,measurements:out.length,report:path}))
