import fs from 'node:fs'

const feed = fs.readFileSync(new URL('../src/SocialFeed.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/social-feed.css', import.meta.url), 'utf8')
const hardeningCss = fs.readFileSync(new URL('../src/feed-snap-hardening.css', import.meta.url), 'utf8')
const runtime = fs.readFileSync(new URL('../src/feed-snap-runtime.ts', import.meta.url), 'utf8')

if (!feed.includes('videoRef.current?.pause()') || !feed.includes('videoRef.current.play()')) throw new Error('Feed não pausa/reproduz vídeo conforme visibilidade.')
if (!feed.includes('onDoubleClick={() => { if (!interactions.liked) void like() }}')) throw new Error('Gesto de curtir por duplo toque/clique não está ativo.')
if (!feed.includes("const feedSessionKey = 'shopvax_social_feed_state_v2'")) throw new Error('Feed não preserva a sessão de navegação atual.')
if (!feed.includes('profilePath(post.store.slug, post.product.id)')) throw new Error('Compartilhamento/navegação social não aponta para o perfil da loja.')
if (!feed.includes('ref={listRef}') || !feed.includes('scrollTopRef.current = event.currentTarget.scrollTop')) throw new Error('Feed ainda depende do scroll da página em vez do próprio container.')
if (feed.includes('window.location.assign(')) throw new Error('Navegação antiga por location.assign ainda está ativa.')
if (!css.includes('overflow-y:auto') || !css.includes('scroll-snap-type:y mandatory') || !css.includes('scroll-snap-stop:always')) throw new Error('Feed vertical em telas não está configurado corretamente.')
if (!css.includes('.social-feed-card{width:min(100%,560px);height:100dvh;min-height:100dvh')) throw new Error('Cada publicação precisa ocupar exatamente uma tela, no padrão Reels/TikTok.')
if (!css.includes('.social-feed-media,.social-feed-media img,.social-feed-media video{position:absolute;inset:0;width:100%;height:100%}')) throw new Error('Mídia do feed não ocupa a publicação inteira.')
if (!css.includes('object-fit:cover')) throw new Error('Foto/vídeo do feed não preenche a tela corretamente.')
if (!css.includes('-webkit-line-clamp:2')) throw new Error('Texto do feed não está limitado para preservar a mídia.')
if (!hardeningCss.includes('var(--shopvax-feed-height, 100dvh)') || !hardeningCss.includes('scroll-snap-type: y mandatory !important') || !hardeningCss.includes('scroll-snap-stop: always !important')) throw new Error('Hardening móvel do scroll snap não está carregado.')
if (!runtime.includes('window.visualViewport?.height') || !runtime.includes('snapToNearest(list)') || !runtime.includes("list.addEventListener('touchend'")) throw new Error('Fallback runtime para Safari/iOS não está ativo.')

console.log('social module 11 static checks ok')
await import('./feed-snap.e2e.mjs')
await import('./social-module20.integration.mjs')
