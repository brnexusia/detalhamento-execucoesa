
export function categoryKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR')
}
export function categoryLabel(value: string) {
  const label=value.normalize('NFC').trim().replace(/\s+/g,' ').slice(0,80).trim()
  return label===label.toLocaleLowerCase('pt-BR') || label===label.toLocaleUpperCase('pt-BR')
    ? label.charAt(0).toLocaleUpperCase('pt-BR')+label.slice(1).toLocaleLowerCase('pt-BR') : label
}
function distance(a:string,b:string) {
  let before=Array.from({length:b.length+1},(_,i)=>i)
  for(let i=1;i<=a.length;i++){
    const row=[i]
    for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,before[j]+1,before[j-1]+(a[i-1]===b[j-1]?0:1))
    before=row
  }
  return before[b.length]
}
export function categoryMatches(names:string[], query:string) {
  const key=categoryKey(query)
  const distinct=Array.from(new Map(names.filter(Boolean).map(name=>[categoryKey(name),name])).values())
  const exact=distinct.find(name=>categoryKey(name)===key)
  const matches=distinct.filter(name=>categoryKey(name).includes(key))
  const similar=key.length>=4&&!exact?distinct.filter(name=>!matches.includes(name)&&distance(categoryKey(name),key)<=1):[]
  return {exact,matches,similar}
}
