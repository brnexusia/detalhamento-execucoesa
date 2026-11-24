// A catalog can have its own visual presentation without duplicating stock.
export function catalogMediaProjection(product){
  return {mediaUrl:product.media_url||'',mediaType:product.media_type==='video'?'video':'image',images:Array.isArray(product.images)?product.images:[],variantImages:Array.isArray(product.variant_images)?product.variant_images:[]}
}
export function withCatalogMedia(product){
  const media=product.media_override
  if(!media||typeof media!=='object'||(!media.media_url&&!media.images?.length))return product
  return {...product,media_url:media.media_url||media.images?.[0]||'',media_type:media.media_type==='video'?'video':'image',images:Array.isArray(media.images)?media.images:[],variant_images:Array.isArray(media.variant_images)?media.variant_images:[]}
}
export function importedCatalogMedia(data){
  const images=Array.isArray(data.images)?data.images.filter(x=>typeof x==='string'&&x.trim()).slice(0,40):[]
  const cover=String(data.media_url||images[0]||'').trim()
  if(!cover&&!images.length)return null
  return {media_url:cover,media_type:data.media_type==='video'?'video':'image',images,variant_images:Array.isArray(data.variant_images)?data.variant_images.slice(0,80):[]}
}
// SQL fragments use fixed aliases p=products, s=stores, fc=chosen feed catalog.
// A legacy store without catalogs still has its original social publication.
export const feedCatalogJoin=`LEFT JOIN LATERAL (
  SELECT c.id,cp.media_override FROM catalogs c
  LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=p.id
  WHERE c.store_id=p.store_id AND c.active=true AND c.feed_enabled=true
    AND (c.is_default OR s.plan_tier='ouro')
    AND CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true) END
  ORDER BY c.is_default DESC,c.created_at,c.id LIMIT 1
) fc ON true`
export const feedCatalogEligible=`(fc.id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM catalogs existing WHERE existing.store_id=p.store_id))`
