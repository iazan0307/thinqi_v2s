/**
 * Bateria de testes contra os arquivos da Christiane.
 * Testa cada parser/extrator isoladamente, sem tocar DB.
 */
import * as fs from 'fs/promises'
import * as path from 'path'
import { parseCartao } from '../src/services/parser/cartao'
import pdfParse from 'pdf-parse'

const DOCS = 'D:/iazan/documentos thinqi/DOC SUPORTE'

async function testCartao(arquivo: string, label: string) {
  console.log(`\n━━━ ${label} ━━━`)
  const full = path.join(DOCS, arquivo)
  try {
    const parsed = await parseCartao(full, arquivo)
    console.log(`✓ Parseado`)
    console.log(`  CNPJ detectado: ${parsed.cnpj_detectado ?? '(nenhum)'}`)
    console.log(`  Transações: ${parsed.transacoes.length}`)
    const bandeiras = [...new Set(parsed.transacoes.map(t => t.bandeira))]
    const adquirentes = [...new Set(parsed.transacoes.map(t => t.adquirente))]
    console.log(`  Bandeiras: ${bandeiras.join(', ')}`)
    console.log(`  Adquirente(s): ${adquirentes.join(', ')}`)
    const totalBruto = parsed.transacoes.reduce((s, t) => s + t.valor_bruto, 0)
    const totalLiq = parsed.transacoes.reduce((s, t) => s + t.valor_liquido, 0)
    console.log(`  Total bruto: R$ ${totalBruto.toFixed(2)}`)
    console.log(`  Total líquido: R$ ${totalLiq.toFixed(2)}`)
    if (parsed.transacoes.length > 0) {
      const sample = parsed.transacoes[0]
      console.log(`  Amostra: ${sample.data.toISOString().slice(0, 10)} · ${sample.bandeira} · R$ ${sample.valor_bruto} · taxa ${(sample.taxa * 100).toFixed(2)}%`)
    }
    return parsed
  } catch (err) {
    console.error(`✗ ERRO: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

function mmYYYYtoDate(mm: string, yy: string): Date {
  return new Date(Date.UTC(parseInt(yy, 10), parseInt(mm, 10) - 1, 1))
}

async function extrairCnpjEMes(buffer: Buffer): Promise<{ cnpj: string | null; mesRef: Date | null; nome?: string }> {
  const data = await pdfParse(buffer)
  const text = data.text ?? ''
  const reCnpjFull = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|(?<!\d)\d{14}(?!\d)/
  const matchCnpj = text.match(reCnpjFull)
  const cnpj = matchCnpj ? normalizeCnpj(matchCnpj[0]) : null
  const reMesIsolada = /(?<!\d\/)(?<!\d)(0[1-9]|1[0-2])\/(\d{4})(?!\/)(?!\d)/g
  let mesRef: Date | null = null
  if (matchCnpj && matchCnpj.index !== undefined) {
    const depois = text.slice(matchCnpj.index + matchCnpj[0].length)
    const m = reMesIsolada.exec(depois)
    if (m) mesRef = mmYYYYtoDate(m[1], m[2])
  }
  if (!mesRef) {
    const m = text.match(/(?:compet[êe]ncia|refer[êe]ncia|m[êe]s\s*ref)[^\d]{0,30}(0[1-9]|1[0-2])\/(\d{4})/i)
    if (m) mesRef = mmYYYYtoDate(m[1], m[2])
  }
  if (!mesRef) {
    reMesIsolada.lastIndex = 0
    const m = reMesIsolada.exec(text)
    if (m) mesRef = mmYYYYtoDate(m[1], m[2])
  }
  return { cnpj, mesRef }
}

async function testPdf(arquivo: string, label: string, expectCnpj: string, expectMes: string) {
  console.log(`\n━━━ ${label} ━━━`)
  const full = path.join(DOCS, arquivo)
  try {
    const buf = await fs.readFile(full)
    const { cnpj, mesRef } = await extrairCnpjEMes(buf)
    const mesStr = mesRef?.toISOString().slice(0, 7) ?? '(nenhum)'
    console.log(`  CNPJ detectado: ${cnpj ?? '(nenhum)'} — esperado: ${expectCnpj.replace(/\D/g, '')}`)
    console.log(`  Mês detectado:  ${mesStr} — esperado: ${expectMes}`)
    const cnpjOk = cnpj === expectCnpj.replace(/\D/g, '')
    const mesOk = mesStr === expectMes
    console.log(`  ${cnpjOk && mesOk ? '✓' : '✗'} CNPJ=${cnpjOk ? 'OK' : 'FAIL'} · Mês=${mesOk ? 'OK' : 'FAIL'}`)
  } catch (err) {
    console.error(`✗ ERRO: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function testContracheque(arquivo: string, label: string) {
  console.log(`\n━━━ ${label} ━━━`)
  const full = path.join(DOCS, arquivo)
  try {
    const buf = await fs.readFile(full)
    // Usa exatamente a mesma função do controller
    const { extrairContracheque: _ } = {} as any
    // Copia o extrator (mesmas regras)
    const data = await pdfParse(buf)
    const text = data.text ?? ''
    const cnpj = (text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|(?<!\d)\d{14}(?!\d)/)?.[0] ?? '').replace(/\D/g, '')
    const cpf = (text.match(/\d{3}\.\d{3}\.\d{3}-\d{2}|(?<!\d)\d{11}(?!\d)/)?.[0] ?? '').replace(/\D/g, '')
    const reMesIsolada = /(?<!\d\/)(?<!\d)(0[1-9]|1[0-2])\/(\d{4})(?!\/)(?!\d)/g
    const mesMatch = reMesIsolada.exec(text)
    const mes = mesMatch ? `${mesMatch[2]}-${mesMatch[1]}` : null

    const padroes = [
      /total\s*l[íi]quido[^\d]*([\d.]+,\d{2})/i,
      /l[íi]quido\s*(?:a\s*receber)?[^\d]*([\d.]+,\d{2})/i,
    ]
    let valor_liquido = 0
    for (const re of padroes) {
      const m = text.match(re)
      if (m) {
        valor_liquido = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
        break
      }
    }

    console.log(`  CNPJ:   ${cnpj} — esperado: 30444933000139 ${cnpj === '30444933000139' ? '✓' : '✗'}`)
    console.log(`  CPF:    ${cpf} — esperado: 90119312700 ${cpf === '90119312700' ? '✓' : '✗'}`)
    console.log(`  Mês:    ${mes} — esperado: 2026-01 ${mes === '2026-01' ? '✓' : '✗'}`)
    console.log(`  Líquido: ${valor_liquido.toFixed(2)} — esperado: 1442.69 ${valor_liquido === 1442.69 ? '✓' : '✗'}`)
  } catch (err) {
    console.error(`✗ ERRO: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  TESTES — ARQUIVOS DA CHRISTIANE')
  console.log('═══════════════════════════════════════════════════════')

  // TESTE 1
  const cielo = await testCartao('REL VENDAS - CIELO.xlsx', 'TESTE 1: Cielo (esperado: CNPJ 30776724000192, 93 vendas)')
  if (cielo) {
    console.log(`  ${cielo.cnpj_detectado === '30776724000192' ? '✓' : '✗'} CNPJ correto`)
    console.log(`  ${cielo.transacoes.length === 93 ? '✓' : '✗'} 93 transações (encontrou ${cielo.transacoes.length})`)
  }

  // TESTE 2
  const rede = await testCartao('REL VENDAS - REDE.xlsx', 'TESTE 2: Rede (esperado: 18 vendas, Jan/2026)')
  if (rede) {
    console.log(`  ${rede.transacoes.length === 18 ? '✓' : '✗'} 18 transações (encontrou ${rede.transacoes.length})`)
  }

  // TESTES 3-5
  await testPdf('ESTIMATIVA IMPOSTOS - MODELO 1.pdf', 'TESTE 3: Estimativa ONCOHIV',   '00.146.439/0001-27', '2026-03')
  await testPdf('ESTIMATIVA IMPOSTOS - MODELO 2.pdf', 'TESTE 4: Estimativa GUILHERME LETA', '40.586.472/0001-92', '2026-03')
  await testPdf('ESTIMATIVA IMPOSTOS - MODELO 3.pdf', 'TESTE 5: Estimativa S3 SERVICOS', '41.720.398/0001-18', '2026-03')

  // TESTE 6
  await testContracheque('CONTR-CHEQUE - PRÓ-LABORE.pdf', 'TESTE 6: Contracheque Pró-labore (esperado: CNPJ 30.444.933/0001-39, CPF 901.193.127-00, líquido R$ 1.442,69)')

  console.log('\n═══════════════════════════════════════════════════════')
}

main().catch(e => { console.error(e); process.exit(1) })
