/** Compressed JSON of the source-photo identities from the 84-shard, 2026-11-16 MAMA audit.
 * Diagnostic snapshot only: use image identity, NEVER the photo's mutable album position, to map a verified price.
 * Source: GitHub Actions run 43805608653. Temporary until visual verification is complete.
 */
import { inflateSync } from 'node:zlib'
const SOURCE_KEYS_ZLIB_BASE64='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'
export const baselineSourceKeys=JSON.parse(inflateSync(Buffer.from(SOURCE_KEYS_ZLIB_BASE64,'base64')).toString('utf8'))

export function canonicalSourcePhotoKey(input) {
  try {
    const u=new URL(String(input))
    if(!/^lh[3-6]$/.test(u.hostname.split('.')[0]) || !u.hostname.endsWith('.googleusercontent.com'))return ''
    return u.pathname.replace(/=[^/=]+$/,'').split('/').at(-1).slice(-22)
  }catch{return ''}
}

export function matchMissedPhotoBySourceIdentity(albumIndex, imageUrls){
  const wanted=baselineSourceKeys[String(albumIndex)]||{}
  const byKey=new Map()
  for(let i=0;i<imageUrls.length;i++){
    const key=canonicalSourcePhotoKey(imageUrls[i])
    if(!key)continue
    if(byKey.has(key))throw Error('Identidade duplicada no álbum: '+key)
    byKey.set(key,{currentPhoto:i+1,imageUrl:imageUrls[i]})
  }
  return Object.entries(wanted).map(([baselinePhoto,key])=>({
    baselinePhoto:Number(baselinePhoto),sourceImageKey:key,...(byKey.get(key)||{currentPhoto:null,imageUrl:null}),
  }))
}
