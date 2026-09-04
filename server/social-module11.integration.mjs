import fs from 'node:fs'

const feed = fs.readFileSync(new URL('../src/SocialFeed.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/social-feed.css', import.meta.url), 'utf8')

if (!feed.includes('videoRef.current?.pause()') || !feed.includes('videoRef.current.play()')) throw new Error('Feed não pausa/reproduz vídeo conforme visibilidade.')
if (!feed.includes('onDoubleClick={() => { if (!interactions.liked) void like() }}')) throw new Error('Gesto de curtir por duplo toque/clique não está ativo.')
if (!feed.includes("const feedSessionKey = 'shopvax_social_feed_state_v2'")) throw new Error('Feed não preserva a sessão de navegação atual.')
if (!feed.includes('profilePath(post.store.slug, post.product.id)')) throw new Error('Compartilhamento/navegação social não aponta para o perfil da loja.')
if (!feed.includes('ref={listRef}') || !feed.includes('scrollTopRef.current = event.currentTarget.scrollTop')) throw new Error('Feed ainda depende do scroll da página em vez do próprio container.')
if (feed.includes('window.location.assign(')) throw new Error('Navegação antiga por location.assign ainda está ativa.')
if (!css.includes('overflow-y:auto') || !css.includes('scroll-snap-type:y mandatory') || !css.includes('scroll-snap-stop:always')) throw new Error('Feed vertical em telas não está configurado corretamente.')
if (!css.includes('-webkit-line-clamp:2')) throw new Error('Texto do feed não está limitado para preservar a mídia.')

console.log('social module 11 ok')
await import('./social-module20.integration.mjs')
