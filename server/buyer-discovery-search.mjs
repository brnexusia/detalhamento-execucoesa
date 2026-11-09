// Pesquisa social: aceita palavras separadas sem permitir curingas arbitrários.
export function buyerSearchPattern(value) {
  const normalized=String(value??'').trim().replace(/\s+/g,' ').slice(0,100)
  return '%'+normalized.replace(/[\\%_]/g,letter=>'\\'+letter).replaceAll(' ','%')+'%'
}
