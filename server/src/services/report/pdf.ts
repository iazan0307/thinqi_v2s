/**
 * Gerador do Relatório de Desconforto Financeiro em PDF.
 * Design ThinQi: roxo primário + slate escuro.
 */

import PDFDocument from 'pdfkit'
import * as fs from 'fs'
import * as path from 'path'
import { ResultadoConciliacao } from '../engine/conciliacao'

// Lê a logo como Buffer na inicialização (evita problemas de path em runtime)
const LOGO_BUFFER: Buffer = fs.readFileSync(
  path.join(__dirname, 'thinqi-logo.png'),
)

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const C = {
  purple:      '#7c4dde',
  purpleLight: '#ede9fe',
  dark:        '#1e293b',
  darkMid:     '#334155',
  gray:        '#64748b',
  grayLight:   '#94a3b8',
  border:      '#e2e8f0',
  bg:          '#f8fafc',
  white:       '#ffffff',
  green:       '#16a34a',
  greenBg:     '#f0fdf4',
  orange:      '#d97706',
  orangeBg:    '#fffbeb',
  red:         '#dc2626',
  redBg:       '#fef2f2',
  amberText:   '#92400e',
  amberBg:     '#fef3c7',
  amberBorder: '#f59e0b',
}

const STATUS_COLOR: Record<string, string> = { OK: C.green,   AVISO: C.orange,   ALERTA: C.red   }
const STATUS_BG:    Record<string, string> = { OK: C.greenBg, AVISO: C.orangeBg, ALERTA: C.redBg }
const STATUS_LABEL: Record<string, string> = {
  OK:    'Dentro do limite (≤ 2%)',
  AVISO: 'Atenção — entre 2% e 5%',
  ALERTA:'Risco fiscal alto (> 5%)',
}

// ─── Formatadores ─────────────────────────────────────────────────────────────
const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtPct = (v: number) => `${v.toFixed(2)}%`
const fmtMes = (d: Date) =>
  new Date(d).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtNow = () => {
  const n = new Date()
  return n.toLocaleDateString('pt-BR') + ' às ' +
    n.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
const fmtCnpj = (c: string) => {
  const d = c.replace(/\D/g, '')
  return d.length === 14
    ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
    : c
}
const fmtRegime = (r: string) =>
  r.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

// ─── Helpers de desenho ───────────────────────────────────────────────────────

function hLine(doc: PDFKit.PDFDocument, x: number, y: number, w: number, color = C.border) {
  doc.moveTo(x, y).lineTo(x + w, y).strokeColor(color).lineWidth(0.5).stroke()
}

function sectionTitle(doc: PDFKit.PDFDocument, label: string, x: number, y: number, w: number) {
  doc.rect(x, y, 3, 14).fill(C.purple)
  doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold')
    .text(label, x + 10, y + 1, { width: w - 10, lineBreak: false })
}

function tableRow(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  opts: { bold?: boolean; highlight?: boolean; valueColor?: string } = {},
) {
  const colValue = x + w - 155
  if (opts.highlight) doc.rect(x, y - 3, w, 22).fill(C.purpleLight)

  doc
    .fillColor(opts.highlight ? C.purple : C.darkMid)
    .fontSize(opts.bold ? 9.5 : 9)
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(label, x + (opts.highlight ? 8 : 5), y + 2, { width: colValue - x - 10, lineBreak: false })

  doc
    .fillColor(opts.valueColor ?? (opts.highlight ? C.purple : C.darkMid))
    .fontSize(opts.bold ? 9.5 : 9)
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(value, colValue, y + 2, { width: 145, align: 'right', lineBreak: false })
}

// ─── Interface pública ────────────────────────────────────────────────────────

export interface EmpresaInfo {
  razao_social: string
  cnpj: string
  regime_tributario: string
}

export function gerarPDFRelatorio(
  resultado: ResultadoConciliacao,
  empresa: EmpresaInfo,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = []

      const doc = new PDFDocument({
        size: 'A4',
        // margens zero: todo controle de posição é manual → sem auto-page-break
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        autoFirstPage: true,
        info: {
          Title:   `Relatório de Desconforto — ${empresa.razao_social}`,
          Author:  'ThinQi Auditoria Financeira',
          Subject: 'Relatório de Desconforto Financeiro',
        },
      })

      doc.on('data',  c => chunks.push(c))
      doc.on('end',   () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const PW = doc.page.width    // 595.28
      const PH = doc.page.height   // 841.89
      const ML = 50
      const W  = PW - ML * 2      // 495.28

      const status      = resultado.status as string
      const statusColor = STATUS_COLOR[status] ?? C.gray
      const statusBg    = STATUS_BG[status]    ?? C.bg

      // ════════════════════════════════════════════════════════════════════
      // 1. HEADER BAND
      // ════════════════════════════════════════════════════════════════════
      doc.rect(0, 0, PW, 80).fill(C.dark)

      // Logo real ThinQi — 528×186px → h=40pt, w≈114pt
      doc.image(LOGO_BUFFER, ML, 20, { height: 40 })

      // Labels à direita
      doc.fillColor(C.grayLight).fontSize(7).font('Helvetica')
        .text('RELATÓRIO DE DESCONFORTO FINANCEIRO', ML, 28, { width: W, align: 'right', lineBreak: false })

      doc.fillColor(C.white).fontSize(9).font('Helvetica-Bold')
        .text(empresa.razao_social.toUpperCase(), ML, 42, { width: W, align: 'right', lineBreak: false })

      doc.fillColor(C.grayLight).fontSize(7.5).font('Helvetica')
        .text(
          `Período: ${fmtMes(resultado.mes_ref)}   ·   Gerado em ${fmtNow()}`,
          ML, 56, { width: W, align: 'right', lineBreak: false },
        )

      // Stripe roxa
      doc.rect(0, 80, PW, 4).fill(C.purple)

      // ════════════════════════════════════════════════════════════════════
      // 2. COMPANY INFO CARD
      // ════════════════════════════════════════════════════════════════════
      const c1Y = 100
      doc.rect(ML, c1Y, W, 62).fillAndStroke(C.bg, C.border)

      doc.fillColor(C.dark).fontSize(13).font('Helvetica-Bold')
        .text(empresa.razao_social, ML + 14, c1Y + 11, { lineBreak: false })

      doc.fillColor(C.gray).fontSize(8.5).font('Helvetica')
        .text(`CNPJ ${fmtCnpj(empresa.cnpj)}   ·   ${fmtRegime(empresa.regime_tributario)}`,
          ML + 14, c1Y + 28, { lineBreak: false })

      hLine(doc, ML + 14, c1Y + 42, W - 28)

      doc.fillColor(C.darkMid).fontSize(8.5).font('Helvetica-Bold')
        .text('Período de referência:', ML + 14, c1Y + 49, { lineBreak: false })

      doc.fillColor(C.purple).fontSize(8.5).font('Helvetica-Bold')
        .text(
          fmtMes(resultado.mes_ref).replace(/^\w/, s => s.toUpperCase()),
          ML + 126, c1Y + 49, { lineBreak: false },
        )

      // ════════════════════════════════════════════════════════════════════
      // 3. DEMONSTRATIVO
      // ════════════════════════════════════════════════════════════════════
      let ry = c1Y + 80

      sectionTitle(doc, 'DEMONSTRATIVO DE CONCILIAÇÃO', ML, ry, W)
      ry += 20

      const rows: [string, string, Parameters<typeof tableRow>[6]][] = [
        ['Faturamento declarado (NFs)',         fmtBRL(resultado.total_faturado),                { bold: true }],
        ['Entradas Banco',                       fmtBRL(resultado.total_entradas_banco),          {}],
        ['(−) Aporte Sócios',                    `− ${fmtBRL(resultado.total_aporte_socios)}`,    { valueColor: C.red }],
        ['(−) Recebimentos CC/CD',               `− ${fmtBRL(resultado.total_recebimentos_cartao)}`, { valueColor: C.red }],
        ['(−) Rendimento Aplicação',             `− ${fmtBRL(resultado.total_rendimento_aplicacao)}`, { valueColor: C.red }],
        ['(−) Resgate Aplicação',                `− ${fmtBRL(resultado.total_resgate_aplicacao)}`, { valueColor: C.red }],
        ['(+) Vendas CC/CD',                     fmtBRL(resultado.total_vendas_cartao),           { valueColor: C.green }],
        ['ENTRADAS REAIS',                       fmtBRL(resultado.total_entradas_real),           { bold: true, highlight: true }],
      ]

      rows.forEach(([label, value, opts], idx) => {
        if (!opts?.highlight && idx % 2 === 0) doc.rect(ML, ry - 3, W, 21).fill('#f1f5f9')
        tableRow(doc, label, value, ML, ry, W, opts)
        ry += 22
      })

      hLine(doc, ML, ry + 3, W)
      ry += 18

      // Diferença — só conta quando entradas > faturamento (sentido contrário não é inconsistência)
      const difColor = resultado.diferenca > 0 ? C.red : C.green
      const difLabel = resultado.diferenca > 0
        ? 'DIFERENÇA NÃO FATURADA'
        : 'FATURAMENTO ≥ ENTRADAS — SEM INCONSISTÊNCIA'
      doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold')
        .text(difLabel, ML + 5, ry + 3, { lineBreak: false })
      doc.fillColor(difColor).fontSize(16).font('Helvetica-Bold')
        .text(fmtBRL(resultado.diferenca), ML, ry - 1, { width: W - 5, align: 'right', lineBreak: false })
      ry += 34

      // ════════════════════════════════════════════════════════════════════
      // 4. STATUS
      // ════════════════════════════════════════════════════════════════════
      sectionTitle(doc, 'ÍNDICE DE INCONSISTÊNCIA FISCAL', ML, ry, W)
      ry += 20

      doc.rect(ML, ry, W, 56).fill(statusBg)
      doc.rect(ML, ry, 4, 56).fill(statusColor)

      doc.fillColor(statusColor).fontSize(28).font('Helvetica-Bold')
        .text(fmtPct(resultado.percentual_inconsistencia), ML + 16, ry + 8, { lineBreak: false })

      doc.fillColor(C.darkMid).fontSize(9).font('Helvetica-Bold')
        .text(STATUS_LABEL[status] ?? status, ML + 16, ry + 40, { lineBreak: false })

      // Pill
      const pillW = 110
      const pillX = ML + W - pillW - 10
      const pillY = ry + 16
      doc.roundedRect(pillX, pillY, pillW, 22, 11).fill(statusColor)
      doc.fillColor(C.white).fontSize(8.5).font('Helvetica-Bold')
        .text(status, pillX, pillY + 6, { width: pillW, align: 'center', lineBreak: false })

      ry += 70

      // ════════════════════════════════════════════════════════════════════
      // 5. NOTA DE ALERTA
      // ════════════════════════════════════════════════════════════════════
      doc.rect(ML, ry, W, 70).fill(C.amberBg)
      doc.rect(ML, ry, 4, 70).fill(C.amberBorder)

      doc.fillColor(C.amberText).fontSize(8.5).font('Helvetica-Bold')
        .text('ATENÇÃO — INFORMAÇÃO CONFIDENCIAL', ML + 14, ry + 9, { lineBreak: false })

      // Texto do aviso (multi-linha controlada)
      doc.fillColor(C.amberText).fontSize(8).font('Helvetica')
        .text(
          'A Receita Federal cruza automaticamente os dados de movimentação bancária, ' +
          'operadoras de cartão de crédito e notas fiscais emitidas. Divergências significativas ' +
          'podem levar a empresa à malha fina e gerar autuações com multas de até 150% do valor ' +
          'sonegado. Recomendamos regularização imediata das inconsistências identificadas.',
          ML + 14, ry + 23, { width: W - 28, lineGap: 2 },
        )

      ry += 82

      // ════════════════════════════════════════════════════════════════════
      // 6. ASSINATURAS
      // ════════════════════════════════════════════════════════════════════
      const sigY = ry + 12
      const lineLen = 155

      hLine(doc, ML + 10, sigY, lineLen, '#cbd5e1')
      hLine(doc, ML + W - lineLen - 10, sigY, lineLen, '#cbd5e1')

      doc.fillColor(C.grayLight).fontSize(7.5).font('Helvetica')
        .text('Responsável Contábil', ML + 10, sigY + 5, { lineBreak: false })
      doc.fillColor(C.grayLight).fontSize(7.5).font('Helvetica')
        .text('Representante da Empresa', ML + W - lineLen - 10, sigY + 5, { lineBreak: false })

      // ════════════════════════════════════════════════════════════════════
      // 7. FOOTER — fixo na base da página
      //    Usa coordenadas absolutas próximas ao fim da página.
      //    Como margins.bottom = 0, não há auto-page-break.
      // ════════════════════════════════════════════════════════════════════
      const fY = PH - 34          // ~808pt em A4

      doc.rect(0, fY - 6, PW, 40).fill(C.dark)

      // Logo no footer — h=18pt → w≈51pt
      doc.image(LOGO_BUFFER, ML, fY + 1, { height: 18 })

      doc.fillColor(C.grayLight).fontSize(7).font('Helvetica')
        .text(
          `Documento confidencial — gerado em ${fmtNow()}`,
          ML, fY + 6, { width: W, align: 'right', lineBreak: false },
        )

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
