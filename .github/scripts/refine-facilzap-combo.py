from pathlib import Path
p=Path('server/scanner-platforms.mjs')
s=p.read_text()
old="""  const sizeMatch = /^(?:tamanho|tam)\\s*[:\\-]?\\s*(.+)$/i.exec(name)
  if (sizeMatch?.[1]) properties.push({ name: 'Tamanho', value: text(sizeMatch[1]) })
  else if (/^(?:pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})$/i.test(name)) properties.push({ name: 'Tamanho', value: name })
  else if (name && !color) properties.push({ name: 'Variação', value: name })
"""
new="""  const sizeColorMatch = /^(pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})\\s*\\(([^)]+)\\)$/i.exec(name)
  const sizeMatch = /^(?:tamanho|tam)\\s*[:\\-]?\\s*(.+)$/i.exec(name)
  if (sizeColorMatch) {
    properties.push({ name: 'Tamanho', value: text(sizeColorMatch[1]) })
    if (!color) properties.push({ name: 'Cor', value: text(sizeColorMatch[2]) })
  } else if (sizeMatch?.[1]) properties.push({ name: 'Tamanho', value: text(sizeMatch[1]) })
  else if (/^(?:pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})$/i.test(name)) properties.push({ name: 'Tamanho', value: name })
  else if (name && !color) properties.push({ name: 'Variação', value: name })
"""
if old not in s: raise SystemExit('variant parser anchor missing')
s=s.replace(old,new)
p.write_text(s)

p=Path('server/scanner-module7.test.mjs')
s=p.read_text()
old="""    '1773005': { id: '1773005', nome: 'Tamanho M', cor: '' },
    '1773006': { id: '1773006', nome: 'Tamanho G', cor: '' },
"""
new="""    '1773005': { id: '1773005', nome: 'M (Preto)', cor: '' },
    '1773006': { id: '1773006', nome: 'G (Azul)', cor: '' },
"""
if old not in s: raise SystemExit('fixture variants anchor missing')
s=s.replace(old,new)
old="""assert.deepEqual(mappedFacil.products[0].properties[0].values, ['M', 'G'])
assert.equal(mappedFacil.products[0].variants[0].size, 'M')
"""
new="""assert.deepEqual(mappedFacil.products[0].properties.find((group) => group.name === 'Tamanho').values, ['M', 'G'])
assert.deepEqual(mappedFacil.products[0].properties.find((group) => group.name === 'Cor').values, ['Preto', 'Azul'])
assert.equal(mappedFacil.products[0].variants[0].size, 'M')
assert.equal(mappedFacil.products[0].variants[0].color, 'Preto')
"""
if old not in s: raise SystemExit('fixture assertions anchor missing')
s=s.replace(old,new)
p.write_text(s)
