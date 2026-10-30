/** Native responsive variants exist for local Shopvax uploads only.
 * External images and videos keep their original URL, avoiding broken CDN URLs.
 */
export function responsiveLocalMedia(src: string | undefined) {
  if (!src || !/^\/media\/[A-Za-z0-9_-]+$/.test(src)) return undefined
  return `${src}?w=320 320w, ${src}?w=960 960w, ${src} 2000w`
}
