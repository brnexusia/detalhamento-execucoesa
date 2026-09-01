import fs from 'node:fs'

const feed = fs.readFileSync(new URL('../src/SocialFeed.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/social-feed.css', import.meta.url), 'utf8')

if (!feed.includes('videoRef.current?.pause()') || !feed.includes('videoRef.current.play()')) throw new Error('Feed não pausa/reproduz vídeo conforme visibilidade.')
if (!feed.includes('onDoubleClick={likeFromGesture}')) throw new Error('Gesto de curtir por duplo toque/clique não está ativo.')
if (!feed.includes("const feedSessionKey = 'shopvax_social_feed_state_v1'")) throw new Error('Feed não preserva a sessão de navegação.')
if (!feed.includes("window.history.pushState({}, '', `/${encodeURIComponent(slug)}`)")) throw new Error('Entrada na loja ainda força recarregamento completo.')
if (feed.includes('window.location.assign(`/${encodeURIComponent(slug)}`)')) throw new Error('Navegação antiga por location.assign ainda está ativa.')
if (!css.includes('scroll-snap-type:y mandatory') || !css.includes('scroll-snap-stop:always')) throw new Error('Snap vertical definitivo não está configurado.')

console.log('social module 11 ok')
