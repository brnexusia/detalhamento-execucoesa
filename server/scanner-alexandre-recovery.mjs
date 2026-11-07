import { prepareReview } from './scanner-review.mjs'
import { importPublishGroupHash } from './scanner-import-grouping.mjs'

const external = value => /^https?:\/\//i.test(String(value || '').trim())
const local = value => /^\/media\/[a-zA-Z0-9-]+$/.test(String(value || ''))

export function planAlexandreRecovery(rows, existingProducts) {
  const seenExternalIds=new Set()
  const byExisting=new Map()
  const existing = existingProducts instanceof Map ? existingProducts :
    new Map((existingProducts || []).map(item=>[item.id,item]))
  for (const row of rows) {
    const sourceId=String(row.external_id || '').trim()
    if (!sourceId || seenExternalIds.has(sourceId))
      throw new Error('IDs de origem ausentes ou duplicados. Recuperação cancelada.')
    seenExternalIds.add(sourceId)
    if (!row.published_product_id || row.publish_result !== 'created')
      throw new Error('Há produtos sem associação a um item publicado. Recuperação manual necessária.')
    const product=existing.get(row.published_product_id)
    if (!product || !product.active)
      throw new Error('Há produtos originais removidos ou inativos; recuperação automática bloqueada.')
    const data=prepareReview(row.data)
    if (!data.publishable)
      throw new Error('Há peça sem nome ou preço válido. Recuperação automática bloqueada.')
    if ([
      data.data.media_url,
      ...(data.data.images || []),
      ...(data.data.variant_images || []).flatMap(v=>v.images || []),
    ].some(external))throw new Error('Há imagens remotas não armazenadas. Recuperação bloqueada.')
    // Do not silently publish an empty photo if it existed in the original.
    if (!local(data.data.media_url) || !(data.data.images || []).some(local))
      throw new Error('Peça sem imagem interna válida. Corrija o armazenamento antes da recuperação.')
    const hash=importPublishGroupHash(data.data,{
      sourcePlatform:'alexandre-bijoux',externalId:sourceId,
    })
    const list=byExisting.get(row.published_product_id) || []
    list.push({...row,prepared:data.data,group_key:hash})
    byExisting.set(row.published_product_id,list)
  }
  const retain=[], create=[]
  for(const [productId,members] of byExisting) {
    const current=existing.get(productId)
    // Existing merged media_url is the first source image selected at publish.
    // Preserve the original product ID for the closest corresponding piece.
    const anchor=members.find(x=>x.prepared.media_url === current.media_url) ||
      members.find(x=>x.prepared.images.includes(current.media_url)) || members[0]
    retain.push({...anchor,productId})
    for(const item of members)if(item!==anchor)create.push(item)
  }
  if (new Set([...retain,...create].map(x=>x.group_key)).size !== rows.length)
    throw new Error('Ainda há peças distintas agrupadas. Operação cancelada.')
  return {retain,create,originals:byExisting.size,total:rows.length}
}
