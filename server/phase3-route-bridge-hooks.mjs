import express from 'express'

function install(app) {
  if (app.__shopvaxPhase3RouteBridgeInstalled) return
  app.__shopvaxPhase3RouteBridgeInstalled = true

  // Mantém compatibilidade com consumidores antigos de /api/business/orders.
  // Se houver cupom, redireciona com 307 para preservar método e corpo e deixa
  // a fachada isolada da Fase 3 concluir o pedido. Sem cupom, o core segue intacto.
  app.post('/api/business/orders', express.json({ limit: '256kb' }), (req, res, next) => {
    if (!String(req.body?.couponCode || '').trim()) return next()
    return res.redirect(307, '/api/business/orders/phase3')
  })
}

const previousInit = express.application.init
express.application.init = function phase3RouteBridgeInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
