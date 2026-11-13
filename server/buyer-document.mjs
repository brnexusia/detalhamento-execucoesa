/**
 * Brasil, 2026: CPF numérico (11) ou CNPJ numérico/alfanumérico (14).
 * Nos novos CNPJs, as 12 primeiras posições aceitam A-Z e 0-9;
 * os dois dígitos verificadores permanecem numéricos.
 */
export function normalizeBuyerDocument(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

function checkCpf(value) {
  if (!/^\d{11}$/.test(value) || /^(.)\1{10}$/.test(value)) return false
  const digits = [...value].map(Number)
  for (let i = 9; i <= 10; i += 1) {
    const sum = digits.slice(0, i).reduce((acc, digit, index) => acc + digit * (i + 1 - index), 0)
    const remainder = (sum * 10) % 11
    if (digits[i] !== (remainder === 10 ? 0 : remainder)) return false
  }
  return true
}

function cnpjDigit(value, weights) {
  const remainder = [...value].reduce((sum, char, index) =>
    sum + (char.charCodeAt(0) - 48) * weights[index], 0) % 11
  return remainder < 2 ? 0 : 11 - remainder
}
function checkCnpj(value) {
  if (!/^[A-Z0-9]{12}\d{2}$/.test(value) || /^(.)\1{12}/.test(value)) return false
  const first = cnpjDigit(value.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2])
  const second = cnpjDigit(value.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2])
  return Number(value[12]) === first && Number(value[13]) === second
}

export function isValidBuyerDocument(value) {
  const document = normalizeBuyerDocument(value)
  if (document.length === 11) return checkCpf(document)
  if (document.length === 14) return checkCnpj(document)
  return false
}
