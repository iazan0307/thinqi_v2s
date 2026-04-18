/**
 * Utilitários de CPF — LGPD compliant.
 * O CPF completo NUNCA é armazenado em texto claro nem exibido em tela.
 */

/** Remove pontuação do CPF: "123.456.789-09" → "12345678909" */
export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '')
}

/** Valida CPF pelo algoritmo oficial */
export function isValidCpf(cpf: string): boolean {
  const digits = normalizeCpf(cpf)
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false

  const calcDigit = (base: string, weights: number[]) =>
    weights.reduce((sum, w, i) => sum + Number(base[i]) * w, 0)

  const rem1 = calcDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]) % 11
  const d1 = rem1 < 2 ? 0 : 11 - rem1

  const rem2 = calcDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) % 11
  const d2 = rem2 < 2 ? 0 : 11 - rem2

  return Number(digits[9]) === d1 && Number(digits[10]) === d2
}

/** Extrai prefixo (3 primeiros) e sufixo (2 últimos) para o motor de regex */
export function extractCpfParts(cpf: string): { prefixo: string; sufixo: string } {
  const digits = normalizeCpf(cpf)
  if (digits.length !== 11) throw new Error('CPF inválido')
  return {
    prefixo: digits.slice(0, 3),
    sufixo: digits.slice(-2),
  }
}

/** Máscara para exibição: "123.***.***-45" (LGPD) */
export function maskCpf(cpf: string): string {
  const digits = normalizeCpf(cpf)
  if (digits.length !== 11) return cpf
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`
}

/**
 * Tenta detectar um fragmento de CPF em uma string de texto (descrição de transação).
 * Retorna o prefixo+sufixo encontrado e o percentual de confiança.
 *
 * Estratégia:
 * 1. Extrai sequências numéricas com 3 ou mais dígitos consecutivos
 * 2. Verifica se alguma sequência começa com os 3 dígitos do prefixo e termina com os 2 do sufixo
 */
export function detectCpfInText(
  text: string,
  prefixo: string,
  sufixo: string,
): { encontrado: boolean; confianca: number } {
  const normalized = text.toUpperCase().replace(/[^0-9\s*X]/g, ' ')
  const sequences = normalized.match(/\d[\d*X\s]{0,10}\d/g) ?? []

  for (const seq of sequences) {
    const digits = seq.replace(/\D/g, '')
    if (digits.length < 5) continue

    const startsWithPrefix = digits.startsWith(prefixo)
    const endsWithSuffix = digits.endsWith(sufixo)

    if (startsWithPrefix && endsWithSuffix) {
      // Match completo com prefixo E sufixo → alta confiança
      return { encontrado: true, confianca: 95 }
    }
    if (startsWithPrefix) {
      // Só prefixo → confiança moderada
      return { encontrado: true, confianca: 70 }
    }
  }

  return { encontrado: false, confianca: 0 }
}
