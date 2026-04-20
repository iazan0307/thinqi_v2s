/**
 * Parser para extratos de operadoras de cartão brasileiras.
 * Suporta: Cielo, Stone, Rede, PagSeguro, Getnet, SafraPay e genérico.
 * Aceita CSV e XLSX. Detecta o adquirente por filename + conteúdo e encontra
 * a linha de cabeçalho automaticamente (Cielo/Rede têm headers fora da linha 1).
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

export interface CartaoParseResult {
  /** CNPJ normalizado (14 dígitos) extraído do arquivo, se encontrado */
  cnpj_detectado: string | null
  transacoes: TransacaoCartaoParseada[]
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
  const clean = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

function parseDate(s: string): Date {
  const clean = s.trim()
  // ISO datetime: 2026-01-21T00:00:00.000Z
  if (/^\d{4}-\d{2}-\d{2}T/.test(clean)) {
    const d = new Date(clean)
    if (!isNaN(d.getTime())) return d
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const m = clean.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/)
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

/** Detecta o adquirente pelo conteúdo (nome do arquivo + primeiras linhas + nome da sheet) */
function detectAdquirente(text: string): string {
  const h = text.toLowerCase()
  if (h.includes('cielo')) return 'CIELO'
  if (h.includes('stone')) return 'STONE'
  if (h.includes('rede') || h.includes('redecard')) return 'REDE'
  if (h.includes('pagseguro') || h.includes('pag seguro') || h.includes('pagbank')) return 'PAGSEGURO'
  if (h.includes('getnet')) return 'GETNET'
  if (h.includes('safrapay') || h.includes('safra pay')) return 'SAFRAPAY'
  return 'GENERICO'
}

/**
 * Extrai o CNPJ do arquivo varrendo todas as células até encontrar o primeiro
 * padrão válido. Aceita tanto formatado (30.776.724/0001-92) quanto digitado
 * (33063484000177) e devolve 14 dígitos normalizados.
 */
function extractCNPJ(rows: string[][]): string | null {
  // Formato com pontuação OU 14 dígitos consecutivos com fronteira
  const re = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|(?<!\d)\d{14}(?!\d)/
  for (const row of rows) {
    for (const cell of row) {
      if (!cell) continue
      const m = cell.match(re)
      if (m) {
        const digits = m[0].replace(/\D/g, '')
        if (digits.length === 14) return digits
      }
    }
  }
  return null
}

/**
 * Busca a linha de cabeçalho nas primeiras 30 linhas.
 * Linha de cabeçalho = tem "bandeira" + alguma coluna de valor.
 */
function findHeaderRowIdx(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(norm)
    const hasBandeira = cells.some(c => c === 'bandeira' || c.startsWith('bandeira'))
    const hasValor = cells.some(c =>
      c.includes('valorbruto') ||
      c.includes('valorliquido') ||
      c.includes('valordavenda') ||
      c.includes('vendaoriginal'),
    )
    if (hasBandeira && hasValor) return i
  }
  return -1
}

/** Encontra a coluna cujo header bate com alguma keyword, ignorando headers que contenham as palavras de exclusão. */
function findCol(headers: string[], keywords: string[], exclude: string[] = []): number {
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i])
    if (!h) continue
    if (exclude.some(k => h.includes(k))) continue
    if (keywords.some(k => h.includes(k))) return i
  }
  return -1
}

function parseRows(
  headers: string[],
  rows: string[][],
  adquirente: string,
): TransacaoCartaoParseada[] {
  // Data da venda — evita colunas de cancelamento/previsão/disputa/lançamento
  let dataIdx = findCol(headers, ['datadavenda', 'datavenda'])
  if (dataIdx === -1) {
    dataIdx = findCol(
      headers,
      ['data'],
      ['cancel', 'previ', 'lanc', 'disputa', 'resol', 'emis', 'hora'],
    )
  }

  const bandeiraIdx = findCol(headers, ['bandeira'])

  // Valor bruto — "valor bruto", "valor da venda original"
  let brutoIdx = findCol(
    headers,
    ['valorbruto', 'vendaoriginal', 'valororiginal'],
    ['atualizado', 'cancel'],
  )
  if (brutoIdx === -1) {
    brutoIdx = findCol(
      headers,
      ['valordavenda', 'bruto', 'gross'],
      ['atualizado', 'cancel', 'liquid', 'mdr', 'taxa'],
    )
  }

  // Valor líquido
  const liquidoIdx = findCol(headers, ['valorliquido', 'liquido'], ['total', 'taxa'])

  // Taxa — preferir taxa MDR / taxa/tarifa; ignorar prazos e embarque
  let taxaIdx = findCol(headers, ['taxamdr'])
  if (taxaIdx === -1) taxaIdx = findCol(headers, ['taxatarifa'])
  if (taxaIdx === -1) {
    taxaIdx = findCol(headers, ['taxa'], ['prazo', 'recebimento', 'embarque', 'valor'])
  }

  if (brutoIdx === -1 && liquidoIdx === -1) {
    throw new Error('Colunas de valor não encontradas no extrato de cartão')
  }

  return rows
    .map(cols => {
      const bruto = brutoIdx >= 0 ? parseBRL(cols[brutoIdx] ?? '') : 0
      const liquido = liquidoIdx >= 0 ? parseBRL(cols[liquidoIdx] ?? '') : 0
      const taxaRaw = Math.abs(taxaIdx >= 0 ? parseBRL(cols[taxaIdx] ?? '') : 0)

      if (bruto <= 0 && liquido <= 0) return null

      let taxa: number
      if (taxaRaw > 0 && taxaRaw < 1) {
        // Já é proporção (ex: Rede → 0.0205)
        taxa = taxaRaw
      } else if (taxaRaw >= 1 && bruto > 0) {
        // Valor em R$ — converte para proporção (ex: Cielo → 8.54 / 700)
        taxa = taxaRaw / bruto
      } else if (bruto > 0 && liquido > 0) {
        taxa = (bruto - liquido) / bruto
      } else {
        taxa = 0
      }
      taxa = Math.min(Math.max(taxa, 0), 0.5) // sanity cap 50%

      return {
        data: dataIdx >= 0 ? parseDate(cols[dataIdx] ?? '') : new Date(),
        bandeira: bandeiraIdx >= 0 ? normBandeira(cols[bandeiraIdx] ?? '') : 'OUTROS',
        adquirente,
        valor_bruto: bruto || liquido / (1 - taxa || 1),
        taxa,
        valor_liquido: liquido || bruto * (1 - taxa),
      } as TransacaoCartaoParseada
    })
    .filter((r): r is TransacaoCartaoParseada => r !== null)
}

// ─── Entrada pública ──────────────────────────────────────────────────────────

export function parseCartaoCSV(content: string, originalName = ''): CartaoParseResult {
  const lines = content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length < 2) throw new Error('Arquivo de cartão vazio ou inválido')

  const delim = detectDelim(lines[0])
  const allRows = lines.map(l =>
    l.split(delim).map(c => c.replace(/^["']|["']$/g, '').trim()),
  )

  const headerIdx = findHeaderRowIdx(allRows)
  const cnpj_detectado = extractCNPJ(allRows)

  if (headerIdx === -1) {
    // Fallback: assume linha 1 é cabeçalho (compat. com formatos simples/legados)
    const headers = allRows[0]
    const rows = allRows.slice(1)
    const adquirente = detectAdquirente([originalName, lines[0]].join(' '))
    return { cnpj_detectado, transacoes: parseRows(headers, rows, adquirente) }
  }

  const preambulo = allRows.slice(0, headerIdx).flat().join(' ')
  const adquirente = detectAdquirente([originalName, preambulo].join(' '))
  const headers = allRows[headerIdx]
  const rows = allRows.slice(headerIdx + 1).filter(r => r.some(c => c.length > 0))
  return { cnpj_detectado, transacoes: parseRows(headers, rows, adquirente) }
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

export async function parseCartaoXLSX(
  buffer: Buffer,
  originalName = '',
): Promise<CartaoParseResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const sheet = workbook.worksheets[0]
  if (!sheet || sheet.rowCount < 2) {
    throw new Error('Planilha de cartão vazia ou inválida')
  }

  const allRows: string[][] = []
  sheet.eachRow((row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(v => cellToString(v))
    allRows.push(vals)
  })

  if (allRows.length === 0) {
    throw new Error('Nenhuma linha de dados encontrada na planilha de cartão')
  }

  const cnpj_detectado = extractCNPJ(allRows)
  const headerIdx = findHeaderRowIdx(allRows)
  if (headerIdx === -1) {
    throw new Error('Cabeçalho do extrato de cartão não identificado (procure por coluna "Bandeira" + "Valor bruto/líquido")')
  }

  const preambulo = allRows.slice(0, headerIdx).flat().join(' ')
  const adquirente = detectAdquirente([originalName, sheet.name, preambulo].join(' '))
  const headers = allRows[headerIdx]
  const rows = allRows.slice(headerIdx + 1).filter(r => r.some(c => c.length > 0))

  return { cnpj_detectado, transacoes: parseRows(headers, rows, adquirente) }
}

/** Entrada unificada — decide CSV/XLSX pela extensão do arquivo. */
export async function parseCartao(
  filePath: string,
  originalName: string,
): Promise<CartaoParseResult> {
  const { promises: fsp } = await import('fs')
  const ext = originalName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await fsp.readFile(filePath)
    return parseCartaoXLSX(buffer, originalName)
  }

  const content = await fsp.readFile(filePath, 'latin1')
  return parseCartaoCSV(content, originalName)
}
