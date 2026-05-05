/**
 * Parser CSV genérico para extratos bancários brasileiros.
 * Detecta automaticamente o formato pelo cabeçalho.
 *
 * Direção da transação (ENTRADA/SAIDA) — ordem de prioridade:
 *   1. Coluna explícita "C/D", "Crédito/Débito", "Tipo Movimento" — quando existe,
 *      é a fonte de verdade (alguns bancos colocam valores absolutos e dependem
 *      desta coluna pra distinguir)
 *   2. Sinal do valor (negativo = saída) — usado quando não há coluna de direção
 *   3. Heurística por palavras-chave na descrição ("PIX RECEBIDO" → ENTRADA,
 *      "PIX ENVIADO" → SAIDA) — fallback final, evita classificar errado quando
 *      o banco emite valores positivos para tudo
 */

import { TransacaoParseada } from './ofx'

interface ColMap {
  data: number
  descricao: number
  valor: number
  /** Índice da coluna de direção C/D quando presente (-1 se ausente) */
  direcao: number
  separator: string
  dateFormat: 'DD/MM/YYYY' | 'YYYY-MM-DD'
}

function parseDate(dateStr: string, format: ColMap['dateFormat']): Date {
  const t = dateStr.trim()
  if (format === 'DD/MM/YYYY') {
    const [d, m, y] = t.split('/').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  const [y, m, d] = t.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function findColIdx(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase()
    if (keywords.some(k => h.includes(k))) return i
  }
  return -1
}

function detectFormat(header: string): ColMap {
  const h = header.toLowerCase()
  const sep = h.includes(';') ? ';' : ','
  const cols = header.split(sep).map(c => c.trim().toLowerCase())

  // Tenta detectar coluna de direção (C/D, Crédito/Débito, Tipo Movimento)
  const direcao = findColIdx(cols, ['c/d', 'cred/deb', 'crédito/débito', 'credito/debito', 'tipo movimento', 'tipo mov', 'natureza'])

  // Bradesco / Itaú: Data;Histórico;Documento;Valor;Saldo
  if (h.includes('hist') && sep === ';') {
    return { data: 0, descricao: 1, valor: 3, direcao, separator: ';', dateFormat: 'DD/MM/YYYY' }
  }
  // Banco do Brasil: Data,Dependencia Origem,Historia,...,Valor
  if (h.includes('historia') || h.includes('história')) {
    return { data: 0, descricao: 2, valor: 5, direcao, separator: ',', dateFormat: 'DD/MM/YYYY' }
  }
  // Formato moderno / Nubank: Data,Descrição,Valor
  return { data: 0, descricao: 1, valor: 2, direcao, separator: sep, dateFormat: 'DD/MM/YYYY' }
}

/**
 * Decide ENTRADA/SAIDA com base em:
 *   1) coluna explícita de direção (quando presente)
 *   2) sinal do valor original
 *   3) heurística textual da descrição (último recurso, evita PIX RECEBIDO virar SAIDA)
 */
function decidirTipo(
  valorOriginal: number,
  direcaoTexto: string | undefined,
  descricao: string,
): 'ENTRADA' | 'SAIDA' {
  // 1) Coluna explícita de direção — fonte de verdade quando presente
  if (direcaoTexto) {
    const d = direcaoTexto.trim().toUpperCase()
    if (d === 'C' || d === 'CR' || d.includes('CRED') || d.includes('CRÉD') || d.includes('ENTRADA') || d === '+') {
      return 'ENTRADA'
    }
    if (d === 'D' || d.includes('DEB') || d.includes('DÉB') || d.includes('SAIDA') || d.includes('SAÍDA') || d === '-') {
      return 'SAIDA'
    }
  }

  // 2) Sinal do valor — só usa quando o banco realmente emite valor signed
  if (valorOriginal < 0) return 'SAIDA'
  if (valorOriginal > 0) {
    // Antes de assumir ENTRADA pelo sinal positivo, verifica heurística textual:
    // alguns bancos exportam tudo positivo e a direção fica só na descrição.
    const dsc = descricao.toLowerCase()
    if (
      /\bpix\s*(?:enviado|enviada|env|debito|débito|saída|saida)\b/.test(dsc) ||
      /\b(transfer[êe]ncia|ted|doc)\s*(?:enviada|enviado|debito|débito|saída|saida)\b/.test(dsc) ||
      /\bpagamento\b/.test(dsc) ||
      /\bcompra\b/.test(dsc) ||
      /\bsaque\b/.test(dsc) ||
      /\bdebito\s+autoriz/.test(dsc) ||
      /\bd[éb]bito\s+autoriz/.test(dsc) ||
      /\btarifa\b/.test(dsc) ||
      /\bIOF\b/.test(descricao)
    ) {
      return 'SAIDA'
    }
    return 'ENTRADA'
  }

  // 3) valor 0: descarta no caller; se chegar aqui, classifica pela descrição
  const dsc = descricao.toLowerCase()
  if (/\b(recebido|recebida|credito|crédito)\b/.test(dsc)) return 'ENTRADA'
  return 'SAIDA'
}

export function parseCSV(content: string): TransacaoParseada[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const fmt = detectFormat(lines[0])
  const transactions: TransacaoParseada[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(fmt.separator).map(c => c.trim().replace(/^"|"$/g, ''))
    const needed = Math.max(fmt.data, fmt.descricao, fmt.valor)
    if (cols.length <= needed) continue

    const valorStr = (cols[fmt.valor] ?? '').replace(/\./g, '').replace(',', '.')
    const valor = parseFloat(valorStr)
    if (isNaN(valor) || valor === 0) continue

    try {
      const data = parseDate(cols[fmt.data] ?? '', fmt.dateFormat)
      if (isNaN(data.getTime())) continue

      const descricao = cols[fmt.descricao] ?? ''
      const direcaoTexto = fmt.direcao >= 0 ? cols[fmt.direcao] : undefined
      const tipo = decidirTipo(valor, direcaoTexto, descricao)

      transactions.push({
        data,
        descricao,
        valor: Math.abs(valor),
        tipo,
      })
    } catch {
      continue
    }
  }

  return transactions
}
