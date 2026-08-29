import express from 'express'

function install(app) {
  if (app.__atacadoApiJsonInstalled) return
  app.__atacadoApiJsonInstalled = true
  app.use(express.json({ limit: '2mb' }))
}

const previousInit = express.application.init
express.application.init = function apiJsonInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
