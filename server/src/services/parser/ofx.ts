/**
 * Parser OFX (SGML / XML) — formato usado pelos bancos brasileiros.
 *
 * Extrai por transação:
 *   - descricao : campo MEMO completo
 *   - nome_contraparte : campo NAME (quando presente — ex: Banco Inter)
 *   - cpf_raw : CPF completo encontrado na descrição (11 dígitos, sem pontuação)
 */

export interface TransacaoParseada {
  data: Date
  descricao: string          // campo MEMO ou NAME como fallback
  nome_contraparte?: string  // campo NAME isolado (ex: "Caroline Silva Senra")
  cpf_raw?: string           // CPF limpo se encontrado na descrição ("02774260736")
  valor: number              // sempre positivo
  tipo: 'ENTRADA' | 'SAIDA'
  fitid?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseOfxDate(dateStr: string): Date {
  const cleaned = dateStr.replace(/\[.*\]/, '').trim()
  const year  = parseInt(cleaned.slice(0, 4), 10)
  const month = parseInt(cleaned.slice(4, 6), 10) - 1
  const day   = parseInt(cleaned.slice(6, 8), 10)
  return new Date(Date.UTC(year, month, day))
}

function extractTag(block: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<\n\r]*)`, 'i')
  const match = regex.exec(block)
  return match ? match[1].trim() : null
}

function mapTrnType(trntype: string, valor: number): 'ENTRADA' | 'SAIDA' {
  const type = trntype.toUpperCase()
  if (['CREDIT', 'DEP', 'INT', 'DIV'].includes(type) || valor > 0) return 'ENTRADA'
  return 'SAIDA'
}

/**
 * Tenta extrair um CPF completo de uma string de texto.
 * Formatos aceitos: "027.742.607-36", "02774260736", "027 742 607 36"
 * Retorna somente os 11 dígitos limpos ou undefined.
 */
function extractCpfFromText(text: string): string | undefined {
  // Formato com pontuação: DDD.DDD.DDD-DD
  const withPunctuation = /\b(\d{3})[.\-\s](\d{3})[.\-\s](\d{3})[.\-\s](\d{2})\b/g
  let m = withPunctuation.exec(text)
  if (m) {
    const digits = m[1] + m[2] + m[3] + m[4]
    if (digits.length === 11) return digits
  }

  // Sequência pura de 11 dígitos (sem letras adjacentes)
  const pure = /(?<!\d)(\d{11})(?!\d)/g
  while ((m = pure.exec(text)) !== null) {
    const digits = m[1]
    // Descarta sequências triviais (00000000000, 11111111111…)
    if (/^(\d)\1{10}$/.test(digits)) continue
    return digits
  }

  return undefined
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseOFX(content: string): TransacaoParseada[] {
  const transactions: TransacaoParseada[] = []

  const stmtPattern = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi

  let match
  while ((match = stmtPattern.exec(content)) !== null) {
    const block = match[1]

    const trntype  = extractTag(block, 'TRNTYPE')
    const dtposted = extractTag(block, 'DTPOSTED')
    const trnamt   = extractTag(block, 'TRNAMT')
    const memo     = extractTag(block, 'MEMO')
    const name     = extractTag(block, 'NAME')
    const fitid    = extractTag(block, 'FITID') ?? undefined

    if (!dtposted || !trnamt) continue

    const valorRaw = parseFloat(trnamt.replace(',', '.'))
    if (isNaN(valorRaw)) continue

    const tipo = mapTrnType(trntype ?? '', valorRaw)

    // descricao = MEMO se existir, senão NAME
    const descricao = memo ?? name ?? ''

    // nome_contraparte = NAME quando existe e é diferente do MEMO
    const nome_contraparte = (name && name !== memo) ? name : undefined

    // Tenta extrair CPF do texto completo disponível
    const textoBusca = [memo, name].filter(Boolean).join(' ')
    const cpf_raw    = extractCpfFromText(textoBusca)

    transactions.push({
      data: parseOfxDate(dtposted),
      descricao,
      nome_contraparte,
      cpf_raw,
      valor: Math.abs(valorRaw),
      tipo,
      fitid,
    })
  }

  return transactions
}
