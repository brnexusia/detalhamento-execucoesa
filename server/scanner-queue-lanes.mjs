/**
 * Separate Google Photos OCR from storefront crawling. A long-running site
 * import must not leave a photo album queued indefinitely.
 *
 * Legacy imported jobs used platform='' even for photos.app.goo.gl. Route
 * them using the original normalized source_host too; no data migration or
 * queue reset is required when this patch is deployed.
 *
 * Static, parameter-free SQL clauses: user input never becomes SQL.
 */
const PHOTO_HOSTS = [
  'photos.app.goo.gl',
  'photos.google.com',
  'photos.googleusercontent.com',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
]
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const hostClause = 'source_host IN (' + PHOTO_HOSTS.map(quote).join(',') + ')'
const photoClause = "(platform<>'pdf' AND (platform IN ('google-photos','image-link') OR " + hostClause + '))'

export function nextScannerJobSql(lane) {
  let condition
  if (lane === 'pdf') condition = "platform='pdf'"
  else if (lane === 'photos') condition = photoClause
  else if (lane === 'site') condition = "platform<>'pdf' AND NOT " + photoClause
  else throw new Error('Lane inválida de scanner: ' + lane)
  return `SELECT id FROM import_jobs
          WHERE status='queued' AND (${condition})
          ORDER BY created_at ASC,id ASC LIMIT 1`
}
