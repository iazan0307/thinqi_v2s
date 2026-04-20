/**
 * Smoke E2E — bateria minuciosa contra o backend rodando.
 *
 * Cobre: login, seed, upload (cartão, estimativa lote, contracheque lote),
 * persistência real (DB), DELETE em cascata, cleanup.
 *
 * Pré-requisito: backend rodando em http://localhost:3001 (npm run dev em server/).
 * Executar: npx tsx scripts/smoke-e2e.ts
 */
import 'dotenv/config'
import * as fs from 'fs/promises'
import * as path from 'path'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/utils/prisma'
import { RegimeTributario } from '@prisma/client'

const API = process.env.API_URL ?? 'http://localhost:3001'
const DOCS = 'D:/iazan/documentos thinqi/DOC SUPORTE'

const ADMIN_EMAIL = 'admin@thinqi.com.br'
const ADMIN_PASS = 'admin@thinqi2024'

type Result = { step: string; ok: boolean; detail: string }
const results: Result[] = []

function record(step: string, ok: boolean, detail = '') {
  results.push({ step, ok, detail })
  const icon = ok ? '✓' : '✗'
  console.log(`  ${icon} ${step}${detail ? ` — ${detail}` : ''}`)
}

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

function formatCnpj(raw: string): string {
  const d = normalizeCnpj(raw)
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`
}

const EMPRESAS = [
  { cnpj: '30.776.724/0001-92', razao: 'CIELO TESTE (Christiane)' },
  { cnpj: '33.063.484/0001-77', razao: 'REDE TESTE (Christiane)' },
  { cnpj: '00.146.439/0001-27', razao: 'ONCOHIV (Christiane)' },
  { cnpj: '40.586.472/0001-92', razao: 'GUILHERME LETA (Christiane)' },
  { cnpj: '41.720.398/0001-18', razao: 'S3 SERVICOS (Christiane)' },
  { cnpj: '30.444.933/0001-39', razao: 'TM ARQUITETURA (Christiane)' },
]

const SOCIA = {
  nome: 'TANIT MARIA',
  cpf: '90119312700',
  empresa_cnpj: '30.444.933/0001-39',
}

async function login(email: string, senha: string): Promise<string> {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Login falhou: ${r.status} ${txt}`)
  }
  const data = await r.json() as { accessToken: string }
  return data.accessToken
}

async function uploadMultipart(
  url: string,
  token: string,
  field: string,
  files: { path: string; filename: string }[],
  extra: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const form = new FormData()
  for (const f of files) {
    const buf = await fs.readFile(f.path)
    const blob = new Blob([new Uint8Array(buf)])
    form.append(field, blob, f.filename)
  }
  for (const [k, v] of Object.entries(extra)) form.append(k, v)

  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  const text = await r.text()
  let body: unknown
  try { body = JSON.parse(text) } catch { body = text }
  return { status: r.status, body }
}

async function seedFixtures() {
  console.log('\n═══ SEED fixtures ═══')
  for (const e of EMPRESAS) {
    await prisma.empresa.upsert({
      where: { cnpj: normalizeCnpj(e.cnpj) },
      update: { razao_social: e.razao },
      create: {
        cnpj: normalizeCnpj(e.cnpj),
        razao_social: e.razao,
        regime_tributario: RegimeTributario.SIMPLES_NACIONAL,
      },
    })
    record(`seed empresa ${e.razao}`, true, normalizeCnpj(e.cnpj))
  }

  const empresaTM = await prisma.empresa.findUnique({ where: { cnpj: normalizeCnpj(SOCIA.empresa_cnpj) } })
  if (!empresaTM) throw new Error('TM ARQUITETURA não foi criada')

  const cpfHash = await bcrypt.hash(SOCIA.cpf, 10)
  const existing = await prisma.socio.findFirst({
    where: { empresa_id: empresaTM.id, cpf_prefixo: SOCIA.cpf.slice(0, 3), cpf_sufixo: SOCIA.cpf.slice(-2) },
  })
  if (!existing) {
    await prisma.socio.create({
      data: {
        empresa_id: empresaTM.id,
        nome: SOCIA.nome,
        cpf_hash: cpfHash,
        cpf_prefixo: SOCIA.cpf.slice(0, 3),
        cpf_sufixo: SOCIA.cpf.slice(-2),
        cpf_mascara: `${SOCIA.cpf.slice(0, 3)}.***.***-${SOCIA.cpf.slice(-2)}`,
        percentual_societario: 100,
        tem_prolabore: false,
        valor_prolabore_mensal: 0,
      },
    })
    record(`seed sócio ${SOCIA.nome}`, true, 'criado')
  } else {
    await prisma.socio.update({
      where: { id: existing.id },
      data: { tem_prolabore: false, valor_prolabore_mensal: 0 },
    })
    record(`seed sócio ${SOCIA.nome}`, true, 'já existia, resetado')
  }
}

async function testCielo(token: string) {
  console.log('\n═══ TESTE 1: Cartão Cielo ═══')
  const file = path.join(DOCS, 'REL VENDAS - CIELO.xlsx')
  const r = await uploadMultipart(`${API}/api/cartao/upload/lote`, token, 'arquivos', [
    { path: file, filename: 'REL VENDAS - CIELO.xlsx' },
  ])
  record(`POST /api/cartao/upload/lote`, r.status === 201, `status=${r.status}`)
  const body = r.body as { resultados?: { status: string; arquivo_id?: string; transacoes_importadas?: number; erro?: string | null }[] }
  const res = body.resultados?.[0]
  if (!res) { record('resposta contém resultado', false, JSON.stringify(body).slice(0, 200)); return null }
  record(`resultado.status = sucesso`, res.status === 'sucesso', res.erro ?? '')
  if (res.status !== 'sucesso') return null

  const arquivoId = res.arquivo_id!
  const empresa = await prisma.empresa.findUnique({ where: { cnpj: normalizeCnpj('30.776.724/0001-92') } })
  const count = await prisma.transacaoCartao.count({ where: { arquivo_id: arquivoId, empresa_id: empresa!.id } })
  record(`DB: transacoes_cartao persistidas`, count === res.transacoes_importadas, `count=${count} esperado=${res.transacoes_importadas}`)
  record(`arquivo_id ArquivoUpload existe`, !!(await prisma.arquivoUpload.findUnique({ where: { id: arquivoId } })))
  return arquivoId
}

async function testRede(token: string) {
  console.log('\n═══ TESTE 2: Cartão Rede ═══')
  const file = path.join(DOCS, 'REL VENDAS - REDE.xlsx')
  const r = await uploadMultipart(`${API}/api/cartao/upload/lote`, token, 'arquivos', [
    { path: file, filename: 'REL VENDAS - REDE.xlsx' },
  ])
  record(`POST /api/cartao/upload/lote (rede)`, r.status === 201, `status=${r.status}`)
  const body = r.body as { resultados?: { status: string; arquivo_id?: string; transacoes_importadas?: number; erro?: string | null }[] }
  const res = body.resultados?.[0]
  if (!res) { record('resposta contém resultado', false, JSON.stringify(body).slice(0, 200)); return null }
  record(`resultado.status = sucesso`, res.status === 'sucesso', res.erro ?? '')
  if (res.status !== 'sucesso') return null
  record(`Rede: 18 transações`, res.transacoes_importadas === 18, `encontrou=${res.transacoes_importadas}`)
  return res.arquivo_id!
}

async function testEstimativas(token: string) {
  console.log('\n═══ TESTE 3/4/5: Estimativas (lote, auto-rota por CNPJ+mês) ═══')
  const files = [1, 2, 3].map(n => ({
    path: path.join(DOCS, `ESTIMATIVA IMPOSTOS - MODELO ${n}.pdf`),
    filename: `ESTIMATIVA IMPOSTOS - MODELO ${n}.pdf`,
  }))
  const r = await uploadMultipart(`${API}/api/estimativa-imposto/upload/lote`, token, 'arquivos', files)
  record(`POST /api/estimativa-imposto/upload/lote`, r.status === 201, `status=${r.status}`)
  const body = r.body as {
    total?: number
    sucesso?: number
    falha?: number
    resultados?: { nome_original: string; status: string; id?: string; empresa_id?: string; empresa_razao?: string; mes_ref?: string; erro?: string | null }[]
  }
  record(`lote.sucesso = 3`, body.sucesso === 3, `sucesso=${body.sucesso} falha=${body.falha}`)

  const expectativas = [
    { file: 'MODELO 1', cnpj: '00146439000127', mes: '2026-03' },
    { file: 'MODELO 2', cnpj: '40586472000192', mes: '2026-03' },
    { file: 'MODELO 3', cnpj: '41720398000118', mes: '2026-03' },
  ]
  for (const exp of expectativas) {
    const res = body.resultados?.find(x => x.nome_original.includes(exp.file))
    if (!res) { record(`${exp.file} presente no retorno`, false); continue }
    record(`${exp.file} status=sucesso`, res.status === 'sucesso', res.erro ?? '')
    if (res.status !== 'sucesso') continue
    record(`${exp.file} mes_ref=${exp.mes}`, res.mes_ref === exp.mes, `got=${res.mes_ref}`)
    // Verifica persistência
    const row = await prisma.estimativaImpostoPDF.findUnique({ where: { id: res.id! } })
    record(`${exp.file} DB row existe`, !!row)
    const empresa = await prisma.empresa.findUnique({ where: { cnpj: exp.cnpj } })
    record(`${exp.file} empresa_id correto`, row?.empresa_id === empresa?.id)
  }
  return body.resultados?.filter(r => r.status === 'sucesso').map(r => r.id!) ?? []
}

async function testContracheque(token: string) {
  console.log('\n═══ TESTE 6: Contracheque de Pró-labore ═══')
  const file = path.join(DOCS, 'CONTR-CHEQUE - PRÓ-LABORE.pdf')
  const r = await uploadMultipart(`${API}/api/contracheque/upload/lote`, token, 'arquivos', [
    { path: file, filename: 'CONTR-CHEQUE - PRÓ-LABORE.pdf' },
  ])
  record(`POST /api/contracheque/upload/lote`, r.status === 201, `status=${r.status}`)
  const body = r.body as {
    total?: number
    sucesso?: number
    resultados?: { status: string; erro?: string | null; socio_nome?: string; valor_prolabore_mensal?: number; mes_ref?: string }[]
  }
  record(`lote.sucesso = 1`, body.sucesso === 1, `resposta=${JSON.stringify(body.resultados?.[0])}`)
  const res = body.resultados?.[0]
  if (!res || res.status !== 'sucesso') return
  record(`valor = 1442.69`, res.valor_prolabore_mensal === 1442.69, `got=${res.valor_prolabore_mensal}`)
  record(`mes_ref = 2026-01`, res.mes_ref === '2026-01', `got=${res.mes_ref}`)

  // DB: sócia TANIT MARIA deve ter tem_prolabore=true e valor igual
  const empresaTM = await prisma.empresa.findUnique({ where: { cnpj: normalizeCnpj(SOCIA.empresa_cnpj) } })
  const socia = await prisma.socio.findFirst({
    where: { empresa_id: empresaTM!.id, cpf_prefixo: SOCIA.cpf.slice(0, 3), cpf_sufixo: SOCIA.cpf.slice(-2) },
  })
  record(`DB sócia.tem_prolabore = true`, socia?.tem_prolabore === true)
  record(`DB sócia.valor_prolabore_mensal = 1442.69`, Number(socia?.valor_prolabore_mensal) === 1442.69, `got=${socia?.valor_prolabore_mensal}`)
}

async function testDeleteCascade(token: string, arquivoId: string | null) {
  console.log('\n═══ TESTE 7: DELETE /api/admin/arquivos/:id com cascade ═══')
  if (!arquivoId) { record('sem arquivo_id para testar', false); return }
  const countAntes = await prisma.transacaoCartao.count({ where: { arquivo_id: arquivoId } })
  record(`transacoes antes = ${countAntes}`, countAntes > 0)
  const r = await fetch(`${API}/api/admin/arquivos/${arquivoId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  record(`DELETE retorna 200`, r.ok, `status=${r.status}`)
  const countDepois = await prisma.transacaoCartao.count({ where: { arquivo_id: arquivoId } })
  record(`transacoes depois = 0 (cascade ok)`, countDepois === 0, `got=${countDepois}`)
  const exists = await prisma.arquivoUpload.findUnique({ where: { id: arquivoId } })
  record(`ArquivoUpload deletado`, !exists)
}

async function testListArquivos(token: string) {
  console.log('\n═══ TESTE 8: GET /api/admin/arquivos ═══')
  const r = await fetch(`${API}/api/admin/arquivos?limit=100`, {
    headers: { authorization: `Bearer ${token}` },
  })
  record(`GET lista arquivos ok`, r.ok, `status=${r.status}`)
  if (!r.ok) return
  const body = await r.json() as { data: { id: string; nome_original: string }[]; meta: { total: number } }
  record(`lista contém ≥ 1 arquivo`, body.data.length > 0, `total=${body.meta.total}`)
}

async function testRoleGuard() {
  console.log('\n═══ TESTE 9: Guardas de autenticação ═══')
  const r1 = await fetch(`${API}/api/admin/arquivos`)
  record(`sem token → 401`, r1.status === 401, `status=${r1.status}`)
  const r2 = await fetch(`${API}/api/cartao/upload/lote`, { method: 'POST' })
  record(`POST sem token → 401`, r2.status === 401, `status=${r2.status}`)
}

async function cleanup() {
  console.log('\n═══ CLEANUP ═══')
  // Limpa arquivos/estimativas criados durante o teste (mas preserva as empresas fixture)
  const cnpjs = EMPRESAS.map(e => normalizeCnpj(e.cnpj))
  const empresas = await prisma.empresa.findMany({ where: { cnpj: { in: cnpjs } } })
  const empresaIds = empresas.map(e => e.id)

  const arquivos = await prisma.arquivoUpload.findMany({ where: { empresa_id: { in: empresaIds } } })
  for (const a of arquivos) {
    await prisma.$transaction([
      prisma.transacaoBancaria.deleteMany({ where: { arquivo_id: a.id } }),
      prisma.transacaoCartao.deleteMany({ where: { arquivo_id: a.id } }),
      prisma.faturamento.deleteMany({ where: { arquivo_id: a.id } }),
      prisma.arquivoUpload.delete({ where: { id: a.id } }),
    ])
  }
  await prisma.estimativaImpostoPDF.deleteMany({ where: { empresa_id: { in: empresaIds } } })
  console.log(`  limpados: ${arquivos.length} arquivos + estimativas`)
}

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  SMOKE E2E — ThinQi V2')
  console.log(`  API: ${API}`)
  console.log('═══════════════════════════════════════════════════════')

  const h = await fetch(`${API}/health`).catch(() => null)
  if (!h?.ok) {
    console.error('❌ Backend não está respondendo em ' + API)
    console.error('   Suba com: cd server && npm run dev')
    process.exit(1)
  }

  await seedFixtures()

  let token: string
  try {
    token = await login(ADMIN_EMAIL, ADMIN_PASS)
    record('login admin', true)
  } catch (e) {
    record('login admin', false, e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  const cieloArquivoId = await testCielo(token)
  await testRede(token)
  await testEstimativas(token)
  await testContracheque(token)
  await testListArquivos(token)
  await testDeleteCascade(token, cieloArquivoId)
  await testRoleGuard()
  await cleanup()

  const ok = results.filter(r => r.ok).length
  const fail = results.filter(r => !r.ok).length
  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`  RESULTADO: ${ok} OK · ${fail} FAIL`)
  console.log('═══════════════════════════════════════════════════════')
  if (fail > 0) {
    console.log('\nFALHAS:')
    for (const r of results.filter(x => !x.ok)) {
      console.log(`  ✗ ${r.step}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async e => {
  console.error('❌ ERRO FATAL:', e)
  await prisma.$disconnect()
  process.exit(1)
})
