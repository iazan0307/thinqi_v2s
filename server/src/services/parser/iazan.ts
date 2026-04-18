/**
 * Parser para planilha do Robô IAZAN (relatório de NFSe).
 *
 * Estrutura esperada (XLSX com 2 abas):
 *   Aba 1 — "Notas Fiscais"
 *     Col 3  : Status              → "Válida" | "Cancelada" | "Válida (DIVERGÊNCIA RETENÇÃO)"
 *     Col 6  : Data da Competência → "MM/YYYY"
 *     Col 7  : Emitente CNPJ
 *     Col 8  : Emitente Nome
 *     Col 12 : Valor Líquido
 *     Col 13 : Valor Serviço       ← base do faturamento bruto
 *     Col 14 : Ret. PIS
 *     Col 15 : Ret. COFINS
 *     Col 16 : Ret. CSLL
 *     Col 17 : Ret. IRRF
 *     Col 18 : Contribuição Previdenciária Retida
 *   Aba 2 — "Auditoria de Quebras"
 *     Furos de sequência de NFs (notas não capturadas)
 *
 * Regras de negócio:
 *   - Somente notas com Status iniciando em "Válida" entram no cálculo
 *   - Faturamento = soma de Valor Serviço (bruto, sem deduções)
 *   - Agrupamento por Competência (mês/ano)
 */

import ExcelJS from 'exceljs'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FaturamentoParseado {
  mes_ref: Date
  cnpj_emitente: string
  nome_emitente: string
  valor_total_nf: number      // soma Valor Serviço das notas válidas
  valor_liquido_total: number // soma Valor Líquido das notas válidas
  total_retencoes: number     // PIS + COFINS + CSLL + IRRF + Prev
  qtd_notas: number
  qtd_canceladas: number
  furos_sequencia: FuroNF[]
}

export interface FuroNF {
  nota_faltante: number
  alerta: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNumber(val: ExcelJS.CellValue): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const clean = val.replace(/[R$\s.]/g, '').replace(',', '.')
    const n = parseFloat(clean)
    return isNaN(n) ? 0 : n
  }
  if (typeof val === 'object' && val !== null && 'result' in (val as object)) {
    return toNumber((val as { result: ExcelJS.CellValue }).result)
  }
  return 0
}

function toString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object' && val !== null && 'result' in (val as object)) {
    return toString((val as { result: ExcelJS.CellValue }).result)
  }
  return ''
}

/**
 * Converte "MM/YYYY" → Date UTC dia 01.
 * Também aceita ISO datetime (ex: "2026-06-01T10:00:00-03:00").
 */
function competenciaToDate(val: ExcelJS.CellValue): Date | null {
  const s = toString(val)
  if (!s) return null

  // Formato MM/YYYY (padrão IAZAN)
  const mmYYYY = s.match(/^(\d{1,2})\/(\d{4})$/)
  if (mmYYYY) {
    const m = parseInt(mmYYYY[1], 10)
    const y = parseInt(mmYYYY[2], 10)
    return new Date(Date.UTC(y, m - 1, 1))
  }

  // Formato ISO (fallback)
  const d = new Date(s)
  if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))

  return null
}

function isValida(status: string): boolean {
  return status.toLowerCase().startsWith('válida') || status.toLowerCase().startsWith('valida')
}

// ─── Leitura da aba "Auditoria de Quebras" ────────────────────────────────────

function parseFuros(wb: ExcelJS.Workbook): FuroNF[] {
  const sheet =
    wb.getWorksheet('Auditoria de Quebras') ??
    wb.getWorksheet('Auditoria') ??
    wb.worksheets[1]

  if (!sheet) return []

  const furos: FuroNF[] = []
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return // pula cabeçalho
    const vals = (row.values as ExcelJS.CellValue[])
    const notaFaltante = toNumber(vals[3]) // col 3
    const alerta = toString(vals[4])       // col 4
    if (notaFaltante > 0) {
      furos.push({ nota_faltante: notaFaltante, alerta })
    }
  })
  return furos
}

// ─── Parser principal XLSX ────────────────────────────────────────────────────

export async function parseIAZAN(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buffer: any,
  mesRefFallback: Date,
): Promise<FaturamentoParseado[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as Parameters<typeof workbook.xlsx.load>[0])

  const sheet =
    workbook.getWorksheet('Notas Fiscais') ??
    workbook.getWorksheet('NF') ??
    workbook.worksheets[0]

  if (!sheet) throw new Error('Aba "Notas Fiscais" não encontrada na planilha')

  // Furos de sequência (aba 2)
  const furos = parseFuros(workbook)

  // Mapa: "YYYY-MM|CNPJ" → acumulador
  const map = new Map<string, {
    mes_ref: Date
    cnpj: string
    nome: string
    valor_servico: number
    valor_liquido: number
    retencoes: number
    qtd_validas: number
    qtd_canceladas: number
  }>()

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return // cabeçalho

    const vals = (row.values as ExcelJS.CellValue[])

    // Leitura por posição (colunas fixas do formato IAZAN)
    const status       = toString(vals[3])   // Col 3
    const competencia  = vals[6]             // Col 6 — "MM/YYYY"
    const cnpj         = toString(vals[7])   // Col 7
    const nomeEmit     = toString(vals[8])   // Col 8
    const valorLiq     = toNumber(vals[12])  // Col 12
    const valorServ    = toNumber(vals[13])  // Col 13
    const retPIS       = toNumber(vals[14])  // Col 14
    const retCOFINS    = toNumber(vals[15])  // Col 15
    const retCSLL      = toNumber(vals[16])  // Col 16
    const retIRRF      = toNumber(vals[17])  // Col 17
    const retPrev      = toNumber(vals[18])  // Col 18

    if (!status) return // linha vazia

    const mesDate = competenciaToDate(competencia) ?? mesRefFallback
    const mesKey  = `${mesDate.getUTCFullYear()}-${String(mesDate.getUTCMonth() + 1).padStart(2, '0')}`
    const mapKey  = `${mesKey}|${cnpj}`

    const retTotal = retPIS + retCOFINS + retCSLL + retIRRF + retPrev

    const entry = map.get(mapKey)
    if (entry) {
      if (isValida(status)) {
        entry.valor_servico += valorServ
        entry.valor_liquido += valorLiq
        entry.retencoes     += retTotal
        entry.qtd_validas++
      } else {
        entry.qtd_canceladas++
      }
    } else {
      map.set(mapKey, {
        mes_ref:        mesDate,
        cnpj:           cnpj,
        nome:           nomeEmit,
        valor_servico:  isValida(status) ? valorServ : 0,
        valor_liquido:  isValida(status) ? valorLiq  : 0,
        retencoes:      isValida(status) ? retTotal  : 0,
        qtd_validas:    isValida(status) ? 1         : 0,
        qtd_canceladas: isValida(status) ? 0         : 1,
      })
    }
  })

  if (map.size === 0) throw new Error('Nenhuma nota fiscal encontrada na planilha')

  return Array.from(map.values()).map(e => ({
    mes_ref:            e.mes_ref,
    cnpj_emitente:      e.cnpj,
    nome_emitente:      e.nome,
    valor_total_nf:     Math.round(e.valor_servico * 100) / 100,
    valor_liquido_total: Math.round(e.valor_liquido * 100) / 100,
    total_retencoes:    Math.round(e.retencoes * 100)     / 100,
    qtd_notas:          e.qtd_validas,
    qtd_canceladas:     e.qtd_canceladas,
    furos_sequencia:    furos,
  }))
}

// ─── Parser CSV (legado / fallback) ──────────────────────────────────────────

export function parseIAZANcsv(
  content: string,
  mesRefFallback: Date,
): FaturamentoParseado[] {
  const lines = content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length < 2) throw new Error('CSV sem dados')

  const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const headers = lines[0].split(delim).map(h => h.replace(/['"]/g, '').trim())

  // Detecta índices pelas colunas do padrão IAZAN
  const colIdx = (keywords: string[]): number =>
    headers.findIndex(h => keywords.some(k => h.toLowerCase().includes(k)))

  const statusIdx     = colIdx(['status'])
  const competIdx     = colIdx(['competência', 'competencia'])
  const cnpjIdx       = colIdx(['emitente cnpj', 'cnpj emitente'])
  const nomeIdx       = colIdx(['emitente nome', 'nome emitente'])
  const valServIdx    = colIdx(['valor serviço', 'valor servico'])
  const valLiqIdx     = colIdx(['valor líquido', 'valor liquido'])

  if (valServIdx === -1) throw new Error('Coluna "Valor Serviço" não encontrada no CSV')

  const map = new Map<string, {
    mes_ref: Date; cnpj: string; nome: string
    valor_servico: number; valor_liquido: number
    qtd_validas: number; qtd_canceladas: number
  }>()

  for (let i = 1; i < lines.length; i++) {
    const cols   = lines[i].split(delim).map(c => c.replace(/['"]/g, '').trim())
    const status = statusIdx >= 0 ? cols[statusIdx] ?? '' : 'Válida'
    const comp   = competIdx >= 0 ? cols[competIdx] ?? '' : ''
    const cnpj   = cnpjIdx >= 0  ? cols[cnpjIdx]   ?? '' : ''
    const nome   = nomeIdx >= 0  ? cols[nomeIdx]   ?? '' : ''

    const mesDate = competenciaToDate(comp) ?? mesRefFallback
    const mesKey  = `${mesDate.getUTCFullYear()}-${String(mesDate.getUTCMonth() + 1).padStart(2, '0')}`
    const mapKey  = `${mesKey}|${cnpj}`

    const valorServ = toNumber(cols[valServIdx] ?? '')
    const valorLiq  = valLiqIdx >= 0 ? toNumber(cols[valLiqIdx] ?? '') : 0

    const entry = map.get(mapKey)
    if (entry) {
      if (isValida(status)) {
        entry.valor_servico += valorServ
        entry.valor_liquido += valorLiq
        entry.qtd_validas++
      } else {
        entry.qtd_canceladas++
      }
    } else {
      map.set(mapKey, {
        mes_ref: mesDate, cnpj, nome,
        valor_servico:  isValida(status) ? valorServ : 0,
        valor_liquido:  isValida(status) ? valorLiq  : 0,
        qtd_validas:    isValida(status) ? 1 : 0,
        qtd_canceladas: isValida(status) ? 0 : 1,
      })
    }
  }

  if (map.size === 0) throw new Error('Nenhuma nota fiscal encontrada no CSV')

  return Array.from(map.values()).map(e => ({
    mes_ref:             e.mes_ref,
    cnpj_emitente:       e.cnpj,
    nome_emitente:       e.nome,
    valor_total_nf:      Math.round(e.valor_servico * 100) / 100,
    valor_liquido_total: Math.round(e.valor_liquido * 100) / 100,
    total_retencoes:     0,
    qtd_notas:           e.qtd_validas,
    qtd_canceladas:      e.qtd_canceladas,
    furos_sequencia:     [],
  }))
}
