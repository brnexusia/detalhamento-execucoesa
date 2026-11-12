/** Native responsive variants exist for local Shopvax uploads only.
 * External images and videos keep their original URL, avoiding broken CDN URLs.
 */
export function responsiveLocalMedia(src: string | undefined) {
  if (!src || !/^\/media\/[A-Za-z0-9_-]+$/.test(src)) return undefined
  // 960px é o maior candidato intencional no srcSet: em telas retina,
  // incluir o original como 2000w fazia o navegador baixar fotos pesadas.
  // O atributo src continua oferecendo o original para navegadores sem srcSet.
  return `${src}?w=320 320w, ${src}?w=960 960w`
}
