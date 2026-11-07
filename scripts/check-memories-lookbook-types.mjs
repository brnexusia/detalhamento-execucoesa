import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { parseNumberedLookbookPages } from '../server/scanner-pdf-lookbook.mjs'

const source=process.env.MEMORIES_PDF_PATH || 'pdf-fixtures/memories-drop-ii.pdf'
const actual=execFileSync('pdftotext',['-layout','-enc','UTF-8',source,'-'],{
  timeout:30000,encoding:'utf8',maxBuffer:2*1024*1024,
})
const pages=actual.replace(/\r/g,'').split('\f').slice(0,67)
const parsed=parseNumberedLookbookPages(pages)
assert.ok(parsed?.lookbook,'The full original catalog must remain identifiable')
assert.equal(parsed.candidates.length,59,'Never lose an originally confirmed price reference')
assert.equal(parsed.typeSuggestions,14,'Only independently corroborated labels are proposed')
assert.equal(new Set(parsed.candidates.map(x=>x.external_id)).size,59)
assert.ok(parsed.candidates.every(x=>Number.isFinite(Number(x.price)) && x.price>0))
const generic=parsed.candidates.filter(x=>/^Acessório para identificar/.test(x.title))
assert.deepEqual(generic.map(x=>x.title).sort(),[
  'Acessório para identificar · Memories · 17-02',
  'Acessório para identificar · Memories · 19-01',
].sort())
const expected = {
 '02-02':'Pulseira','02-03':'Pulseira','04-02':'Colar','04-03':'Bracelete',
 '07-03':'Pulseira','09-04':'Bracelete','10-03':'Bracelete',
 '12-02':'Colar','16-02':'Colar','17-01':'Brinco',
 '17-03':'Bracelete','17-04':'Bracelete','17-05':'Bracelete',
 '18-01':'Bolsa',
}
const example=[]
for(const [ref,type] of Object.entries(expected)){
 const item=parsed.candidates.find(x=>x.title.endsWith(' · '+ref))
 assert.ok(item,'Missing reference '+ref)
 assert.match(item.title,new RegExp('^'+type+' \u00b7'))
 assert.equal(item.pdf_review_required,true,ref+' must remain manual review')
 assert.match(item.description,/TIPO SUGERIDO/,ref+' needs source evidence')
 example.push({ref,type,price:item.price,source:item.pdf_type_suggestion_page})
}
console.log('MEMORIES_TYPES_CHECK',JSON.stringify({
 references:parsed.candidates.length,proposed:parsed.typeSuggestions,
 remainingGeneric:generic.map(x=>x.title),proposals:example,
}))
