/**
 * Parser para extratos de operadoras de cartão brasileiras.
 * Suporta: Cielo, Stone, Rede, PagSeguro e formato genérico.
 * Aceita CSV e XLSX. Detecta o adquirente automaticamente pelo cabeçalho do arquivo.
 */

import ExcelJS from 'exceljs'

export interface TransacaoCartaoParseada {
  data: Date
  bandeira: string       // VISA, MASTER, ELO, AMEX, etc.
  adquirente: string     // CIELO, STONE, REDE, PAGSEGURO
  valor_bruto: number
  taxa: number           // 0 a 1 (ex: 0.0199 = 1,99%)
  valor_liquido: number
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function parseBRL(s: string): number {
  if (!s) return 0
  const clean = s.replace(/[R$\s]/g, '').replace('.', '').replace(',', '.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

function parseDate(s: string): Date {
  const clean = s.trim()
  // DD/MM/YYYY or DD-MM-YYYY
  const m = clean.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/)
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))
  // YYYY-MM-DD
  const m2 = clean.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m2) return new Date(Date.UTC(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3])))
  return new Date()
}

function detectDelim(header: string): string {
  const semi = (header.match(/;/g) ?? []).length
  const comma = (header.match(/,/g) ?? []).length
  const pipe = (header.match(/\|/g) ?? []).length
  if (pipe > semi && pipe > comma) return '|'
  if (semi >= comma) return ';'
  return ','
}

function normBandeira(s: string): string {
  const n = norm(s)
  if (n.includes('visa')) return 'VISA'
  if (n.includes('master') || n.includes('maestro')) return 'MASTERCARD'
  if (n.includes('elo')) return 'ELO'
  if (n.includes('amex') || n.includes('american')) return 'AMEX'
  if (n.includes('hipercard') || n.includes('hiper')) return 'HIPERCARD'
  return s.toUpperCase().trim() || 'OUTROS'
}

/** Detecta o adquirente pelo conteúdo do cabeçalho */
function detectAdquirente(header: string): string {
  const h = header.toLowerCase()
  if (h.includes('cielo')) return 'CIELO'
  if (h.includes('stone')) return 'STONE'
  if (h.includes('rede') || h.includes('redecard')) return 'REDE'
  if (h.includes('pagseguro') || h.includes('pag seguro')) return 'PAGSEGURO'
  if (h.includes('getnet')) return 'GETNET'
  if (h.includes('safrapay')) return 'SAFRAPAY'
  return 'GENERICO'
}

// ─── Parsers por adquirente ───────────────────────────────────────────────────

/**
 * Formato Cielo:
 * Data;Bandeira;Tipo;Valor Bruto;Taxa (%);Valor Líquido
 */
function parseCielo(rows: string[][], adquirente: string): TransacaoCartaoParseada[] {
  return rows
    .map(cols => {
      const bruto = parseBRL(cols[3] ?? '')
      const taxaPct = parseFloat((cols[4] ?? '0').replace(',', '.')) / 100
      const liquido = parseBRL(cols[5] ?? '') || bruto * (1 - taxaPct)
      if (bruto <= 0) return null
      return {
        data: parseDate(cols[0] ?? ''),
        bandeira: normBandeira(cols[1] ?? ''),
        adquirente,
        valor_bruto: bruto,
        taxa: taxaPct,
        valor_liquido: liquido,
      } as TransacaoCartaoParseada
    })
    .filter((r): r is TransacaoCartaoParseada => r !== null)
}

/**
 * Formato Stone:
 * data_pagamento,produto,bandeira,valor_bruto,taxa,valor_liquido
 */
function parseStone(rows: string[][], adquirente: string): TransacaoCartaoParseada[] {
  return rows
    .map(cols => {
      const bruto = parseBRL(cols[3] ?? '')
      const taxaVal = parseBRL(cols[4] ?? '')
      const liquido = parseBRL(cols[5] ?? '') || bruto - taxaVal
      if (bruto <= 0) return null
      return {
        data: parseDate(cols[0] ?? ''),
        bandeira: normBandeira(cols[2] ?? ''),
        adquirente,
        valor_bruto: bruto,
        taxa: bruto > 0 ? taxaVal / bruto : 0,
        valor_liquido: liquido,
      } as TransacaoCartaoParseada
    })
    .filter((r): r is TransacaoCartaoParseada => r !== null)
}

/** Parser genérico: detecta colunas por nome */
function parseGenerico(
  headers: string[],
  rows: string[][],
  adquirente: string,
): TransacaoCartaoParseada[] {
  const find = (keywords: string[]) =>
    headers.findIndex(h => keywords.some(k => norm(h).includes(k)))

  const dataIdx = find(['data', 'date', 'dt'])
  const bandeiraIdx = find(['bandeira', 'cartao', 'produto', 'brand', 'tipo'])
  const brutoIdx = find(['bruto', 'gross', 'original', 'venda'])
  const taxaIdx = find(['taxa', 'mdr', 'fee', 'desconto', 'rate'])
  const liquidoIdx = find(['liquido', 'liquida', 'net', 'receber', 'creditado'])

  if (brutoIdx === -1 && liquidoIdx === -1) {
    throw new Error('Colunas de valor não encontradas no extrato de cartão')
  }

  return rows
    .map(cols => {
      const bruto = brutoIdx >= 0 ? parseBRL(cols[brutoIdx] ?? '') : 0
      const liquido = liquidoIdx >= 0 ? parseBRL(cols[liquidoIdx] ?? '') : 0
      const taxaRaw = taxaIdx >= 0 ? parseBRL(cols[taxaIdx] ?? '') : 0
      const valorRef = bruto || liquido
      if (valorRef <= 0) return null

      const taxa = bruto > 0 && taxaRaw > 0
        ? (taxaRaw < 1 ? taxaRaw : taxaRaw / bruto)
        : (bruto > 0 && liquido > 0 ? (bruto - liquido) / bruto : 0)

      return {
        data: dataIdx >= 0 ? parseDate(cols[dataIdx] ?? '') : new Date(),
        bandeira: bandeiraIdx >= 0 ? normBandeira(cols[bandeiraIdx] ?? '') : 'OUTROS',
        adquirente,
        valor_bruto: bruto || liquido / (1 - taxa),
        taxa: Math.min(taxa, 0.5),        // sanity cap 50%
        valor_liquido: liquido || bruto * (1 - taxa),
      } as TransacaoCartaoParseada
    })
    .filter((r): r is TransacaoCartaoParseada => r !== null)
}

// ─── Entrada pública ──────────────────────────────────────────────────────────

function dispatch(
  headers: string[],
  rows: string[][],
  adquirente: string,
): TransacaoCartaoParseada[] {
  if (adquirente === 'CIELO') return parseCielo(rows, adquirente)
  if (adquirente === 'STONE') return parseStone(rows, adquirente)
  return parseGenerico(headers, rows, adquirente)
}

export function parseCartaoCSV(content: string): TransacaoCartaoParseada[] {
  const lines = content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length < 2) throw new Error('Arquivo de cartão vazio ou inválido')

  const adquirente = detectAdquirente(lines[0])
  const delim = detectDelim(lines[0])
  const headers = lines[0].split(delim).map(h => h.replace(/['"]/g, '').trim())
  const rows = lines.slice(1).map(l => l.split(delim).map(c => c.replace(/['"]/g, '').trim()))

  return dispatch(headers, rows, adquirente)
}

function cellToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return ''
  if (val instanceof Date) {
    const dd = String(val.getUTCDate()).padStart(2, '0')
    const mm = String(val.getUTCMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${val.getUTCFullYear()}`
  }
  if (typeof val === 'number') {
    return String(val).replace('.', ',')
  }
  if (typeof val === 'object' && 'text' in val) {
    return String((val as { text: string }).text ?? '').trim()
  }
  if (typeof val === 'object' && 'result' in val) {
    return cellToString((val as { result: ExcelJS.CellValue }).result)
  }
  return String(val).trim()
}

export async function parseCartaoXLSX(buffer: Buffer): Promise<TransacaoCartaoParseada[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const sheet = workbook.worksheets[0]
  if (!sheet || sheet.rowCount < 2) {
    throw new Error('Planilha de cartão vazia ou inválida')
  }

  const headerRow = sheet.getRow(1)
  const headers = (headerRow.values as ExcelJS.CellValue[])
    .slice(1)
    .map(v => cellToString(v))

  const headerText = [sheet.name, ...headers].join(' ')
  const adquirente = detectAdquirente(headerText)

  const rows: string[][] = []
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(v => cellToString(v))
    if (vals.some(v => v.length > 0)) rows.push(vals)
  })

  if (rows.length === 0) throw new Error('Nenhuma linha de dados encontrada na planilha de cartão')

  return dispatch(headers, rows, adquirente)
}

/** Entrada unificada — decide CSV/XLSX pela extensão do arquivo. */
export async function parseCartao(
  filePath: string,
  originalName: string,
): Promise<TransacaoCartaoParseada[]> {
  const { promises: fsp } = await import('fs')
  const ext = originalName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await fsp.readFile(filePath)
    return parseCartaoXLSX(buffer)
  }

  const content = await fsp.readFile(filePath, 'latin1')
  return parseCartaoCSV(content)
}
