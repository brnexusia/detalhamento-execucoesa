from pathlib import Path

p = Path('server/scanner-platforms.mjs')
s = p.read_text()
old = '''function facilZapVariantProperties(nameValue, colorValue) {
  const name = text(nameValue)
  const color = text(colorValue)
  const properties = []
  if (color) properties.push({ name: 'Cor', value: color })

  const sizeColorMatch = /^(pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})\\s*\\(([^)]+)\\)$/i.exec(name)
  const sizeMatch = /^(?:tamanho|tam)\\s*[:\\-]?\\s*(.+)$/i.exec(name)
  if (sizeColorMatch) {
    properties.push({ name: 'Tamanho', value: text(sizeColorMatch[1]) })
    if (!color) properties.push({ name: 'Cor', value: text(sizeColorMatch[2]) })
  } else if (sizeMatch?.[1]) properties.push({ name: 'Tamanho', value: text(sizeMatch[1]) })
  else if (/^(?:pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})$/i.test(name)) properties.push({ name: 'Tamanho', value: name })
  else if (name && !color) properties.push({ name: 'Variação', value: name })
  return properties
}
'''
new = '''function facilZapVariantProperties(nameValue, colorValue) {
  const name = text(nameValue)
  const color = text(colorValue)
  const properties = []
  const technicalColor = /^(?:#[0-9a-f]{3,8}|rgba?\\(|hsla?\\()/i.test(color)

  const sizeColorMatch = /^(pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})\\s*\\(([^)]+)\\)$/i.exec(name)
  const sizeMatch = /^(?:tamanho|tam)\\s*[:\\-]?\\s*(.+)$/i.exec(name)
  const plainSize = /^(?:pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})$/i.test(name)

  if (sizeColorMatch) {
    properties.push({ name: 'Tamanho', value: text(sizeColorMatch[1]) })
    properties.push({ name: 'Cor', value: text(sizeColorMatch[2]) })
  } else if (sizeMatch?.[1]) {
    properties.push({ name: 'Tamanho', value: text(sizeMatch[1]) })
    if (color) properties.push({ name: 'Cor', value: color })
  } else if (plainSize) {
    properties.push({ name: 'Tamanho', value: name })
    if (color) properties.push({ name: 'Cor', value: color })
  } else if (technicalColor && name) {
    // FácilZap moderno envia o nome humano em `nome` e a amostra visual em `cor`.
    // A variação da loja deve mostrar "Prata"/"Grafite", não "#b8bec4".
    properties.push({ name: 'Cor', value: name })
  } else if (color) {
    properties.push({ name: 'Cor', value: color })
    if (name && name.toLocaleLowerCase('pt-BR') != color.toLocaleLowerCase('pt-BR')) properties.push({ name: 'Variação', value: name })
  } else if (name) {
    properties.push({ name: 'Variação', value: name })
  }
  return properties
}
'''
if old not in s:
    raise SystemExit('anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('server/scanner-module7.test.mjs')
s = p.read_text()
anchor = "assert.equal(mappedFacil.products[0].availability, 'InStock')\n"
addition = """assert.equal(mappedFacil.products[0].availability, 'InStock')

const namedColorFacil = facilZapProducts({ produtos: [{
  id: '4263588', nome: 'Pulseira', sku: 'FZ4263588', preco: 37.5,
  variacoes: {
    '2124362': { id: '2124362', nome: 'Prata', cor: '#b8bec4' },
    '2130878': { id: '2130878', nome: 'Grafite', cor: '#8a8787' },
  },
  sku_variacoes: { '2124362': 'FZ4263588.1', '2130878': 'FZ4263588.2' },
}] }, 'https://cristaluxe.example/')
assert.deepEqual(namedColorFacil.products[0].properties.find((group) => group.name === 'Cor').values, ['Prata', 'Grafite'])
assert.equal(namedColorFacil.products[0].variants[0].color, 'Prata')
assert.equal(namedColorFacil.products[0].variants[1].color, 'Grafite')
"""
if anchor not in s:
    raise SystemExit('test anchor not found')
s = s.replace(anchor, addition, 1)
p.write_text(s)
