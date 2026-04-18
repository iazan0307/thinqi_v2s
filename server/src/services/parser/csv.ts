/**
 * Parser CSV genérico para extratos bancários brasileiros.
 * Detecta automaticamente o formato pelo cabeçalho.
 */

import { TransacaoParseada } from './ofx'

interface ColMap {
  data: number
  descricao: number
  valor: number
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

function detectFormat(header: string): ColMap {
  const h = header.toLowerCase()
  const sep = h.includes(';') ? ';' : ','

  // Bradesco / Itaú: Data;Histórico;Documento;Valor;Saldo
  if (h.includes('hist') && sep === ';') {
    return { data: 0, descricao: 1, valor: 3, separator: ';', dateFormat: 'DD/MM/YYYY' }
  }
  // Banco do Brasil: Data,Dependencia Origem,Historia,...,Valor
  if (h.includes('historia') || h.includes('história')) {
    return { data: 0, descricao: 2, valor: 5, separator: ',', dateFormat: 'DD/MM/YYYY' }
  }
  // Formato moderno / Nubank: Data,Descrição,Valor
  return { data: 0, descricao: 1, valor: 2, separator: sep, dateFormat: 'DD/MM/YYYY' }
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

      transactions.push({
        data,
        descricao: cols[fmt.descricao] ?? '',
        valor: Math.abs(valor),
        tipo: valor >= 0 ? 'ENTRADA' : 'SAIDA',
      })
    } catch {
      continue
    }
  }

  return transactions
}
