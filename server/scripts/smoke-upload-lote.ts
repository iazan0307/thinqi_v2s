/**
 * Smoke test do upload em lote — não toca o banco, valida só os helpers puros:
 *   - extractCNPJfromOFX em diferentes formatos de arquivo
 *   - detectarTipoLote em OFX/CSV/XLSX/PDF/XML
 *
 * Rodar: cd server && npx tsx scripts/smoke-upload-lote.ts
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { extractCNPJfromOFX, extractOFXIdentificacao, nomeBanco, parseOFX } from '../src/services/parser/ofx'
import { detectarTipoLote } from '../src/services/parser/uploadLoteDispatcher'
import { _extrairTotalGeralForTest as extrairTotalGeral } from '../src/controllers/estimativaImpostoController'
import { parseCSV } from '../src/services/parser/csv'
import { calcularIrDevido, LIMITE_DISTRIBUICAO_ISENTA, STATUS_DISTRIBUICAO } from '../src/utils/distribuicao'
import { hashBuffer } from '../src/utils/hash'
import {
  isRendimentoAplicacao, isResgateAplicacao, isRecebimentoCartao, isInvestimentoAutomatico,
} from '../src/utils/investimento'

let falhas = 0
function expect(label: string, atual: unknown, esperado: unknown): void {
  // Tolerância de 0.005 para comparação numérica (precisão de centavos)
  let ok: boolean
  if (typeof atual === 'number' && typeof esperado === 'number') {
    ok = Math.abs(atual - esperado) < 0.005
  } else {
    ok = JSON.stringify(atual) === JSON.stringify(esperado)
  }
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) {
    console.log(`   esperado: ${JSON.stringify(esperado)}`)
    console.log(`   atual:    ${JSON.stringify(atual)}`)
    falhas++
  }
}

// ─── Teste 1: extractCNPJfromOFX ──────────────────────────────────────────────

const ofxFormatado = `
<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>BANCO INTER</ORG><FID>077</FID></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM>
<BANKID>077</BANKID>
<ACCTID>30776724000192</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE>
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101</DTSTART>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260105</DTPOSTED>
<TRNAMT>-100.00</TRNAMT>
<MEMO>TED para CPF 02774260736</MEMO>
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`
expect('OFX com 14 dígitos no ACCTID', extractCNPJfromOFX(ofxFormatado), '30776724000192')

const ofxComPontuacao = `<OFX>
<!-- CNPJ Empresa: 33.063.484/0001-77 -->
<BANKACCTFROM><ACCTID>123456</ACCTID></BANKACCTFROM>
</OFX>`
expect('OFX com CNPJ formatado em comentário', extractCNPJfromOFX(ofxComPontuacao), '33063484000177')

const ofxTagCNPJ = `<OFX><FI><ORG>Inter</ORG><CNPJ>11222333000181</CNPJ></FI></OFX>`
expect('OFX com tag <CNPJ>', extractCNPJfromOFX(ofxTagCNPJ), '11222333000181')

const ofxSemCNPJ = `<OFX><BANKACCTFROM><ACCTID>00000123</ACCTID></BANKACCTFROM></OFX>`
expect('OFX sem CNPJ identificável', extractCNPJfromOFX(ofxSemCNPJ), null)

const ofxComLixo = `<OFX><BANKACCTFROM><ACCTID>11111111111111</ACCTID></BANKACCTFROM></OFX>`
expect('OFX com 14 dígitos repetidos (descarta)', extractCNPJfromOFX(ofxComLixo), null)

// ─── Teste: extractOFXIdentificacao ───────────────────────────────────────────

const ofxItau = `<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>Itau</ORG><FID>341</FID></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM>
<BANKID>341</BANKID>
<BRANCHID>1234</BRANCHID>
<ACCTID>56789-0</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE>
</BANKACCTFROM>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`
const idItau = extractOFXIdentificacao(ofxItau)
expect('Identifica Itaú BANKID', idItau?.bank_id, '341')
expect('Identifica Itaú ACCTID normalizado', idItau?.acct_id, '567890')
expect('Itaú ACCTID display preserva hífen', idItau?.acct_id_display, '56789-0')
expect('Itaú agencia', idItau?.agencia, '1234')
expect('Itaú accType', idItau?.account_type, 'CHECKING')
expect('Itaú bank_name resolvido', idItau?.bank_name, 'Itaú')

const ofxBradescoSemBranch = `<OFX><BANKACCTFROM><BANKID>237</BANKID><ACCTID>123456789</ACCTID></BANKACCTFROM></OFX>`
const idBra = extractOFXIdentificacao(ofxBradescoSemBranch)
expect('Bradesco sem branch', idBra?.agencia, undefined)
expect('Bradesco bank_name', idBra?.bank_name, 'Bradesco')

const ofxSemAcct = `<OFX><BANKACCTFROM><BANKID>077</BANKID></BANKACCTFROM></OFX>`
expect('OFX sem ACCTID retorna null', extractOFXIdentificacao(ofxSemAcct), null)

expect('nomeBanco padding zero (77 → 077)', nomeBanco('77'), 'Inter')
expect('nomeBanco desconhecido', nomeBanco('999'), 'Banco 999')

// ─── Teste: extrairTotalGeral (estimativa de impostos) ────────────────────────

// Replica o layout do briefing — guia trimestral com coluna TOTAL e Mês corrente
const pdfTextoTrimestral = `
ESTIMATIVA DE IMPOSTOS — ABRIL/2026
CNPJ: 12.345.678/0001-99

TRIBUTO    VENCIMENTO    R$ (TOTAL)    Mês
ISS        06/04/2026    372,93        372,93
PIS        24/04/2026    202,48        202,48
COFINS     24/04/2026    934,50        934,50
CSLL       30/04/2026    5.759,58      1.919,86
IRPJ       30/04/2026    9.925,96      3.308,65
INSS       20/04/2026    2.622,00      2.622,00

TOTAL DO MÊS                            9.359,42
TOTAL                    19.817,32
`
expect('Estimativa: pega TOTAL consolidado (não TOTAL DO MÊS)', extrairTotalGeral(pdfTextoTrimestral), 19817.32)

// Modelo 2 do briefing — Guilherme Leta R$ 10.801,22
const pdfModelo2 = `
TRIBUTO    VENCIMENTO    R$
ISS        15/04/2026    1.234,56
DAS        20/04/2026    9.566,66
TOTAL                    10.801,22
`
expect('Estimativa Modelo 2 — R$ 10.801,22', extrairTotalGeral(pdfModelo2), 10801.22)

// Modelo 3 — sem linha "TOTAL" consolidada — soma os tributos pela coluna esquerda
const pdfSemTotal = `
TRIBUTO    VENCIMENTO    R$ (TOTAL)
ISS        06/04/2026    1.000,00
PIS        24/04/2026    2.000,00
COFINS     24/04/2026    2.215,47
`
expect('Estimativa sem TOTAL — soma os tributos', extrairTotalGeral(pdfSemTotal), 5215.47)

// ─── Teste: parseOFX direção da transação ─────────────────────────────────────

const ofxPixRecebido = `<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>237</BANKID><ACCTID>123456</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260115</DTPOSTED>
<TRNAMT>4000.00</TRNAMT>
<MEMO>PIX RECEBIDO João Silva</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260116</DTPOSTED>
<TRNAMT>-1500.00</TRNAMT>
<MEMO>PIX ENVIADO 02774260736</MEMO>
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`
const txOfx = parseOFX(ofxPixRecebido)
expect('OFX PIX RECEBIDO classificado como ENTRADA', txOfx[0]?.tipo, 'ENTRADA')
expect('OFX PIX ENVIADO classificado como SAIDA', txOfx[1]?.tipo, 'SAIDA')

// ─── Teste: parseCSV — heurística de direção quando valor é positivo ──────────

const csvSantanderTudoPositivo = `Data;Histórico;Documento;Valor;Saldo
15/01/2026;PIX RECEBIDO João;123;4000,00;9000,00
16/01/2026;PIX ENVIADO Maria;124;1500,00;7500,00
17/01/2026;PAGAMENTO BOLETO;125;500,00;7000,00
18/01/2026;TARIFA PACOTE;126;30,00;6970,00`
const txCsv = parseCSV(csvSantanderTudoPositivo)
expect('CSV PIX RECEBIDO (positivo) → ENTRADA', txCsv[0]?.tipo, 'ENTRADA')
expect('CSV PIX ENVIADO (positivo, palavra-chave) → SAIDA', txCsv[1]?.tipo, 'SAIDA')
expect('CSV PAGAMENTO (positivo, palavra-chave) → SAIDA', txCsv[2]?.tipo, 'SAIDA')
expect('CSV TARIFA (positivo, palavra-chave) → SAIDA', txCsv[3]?.tipo, 'SAIDA')

const csvSignedValor = `Data;Histórico;Documento;Valor;Saldo
15/01/2026;Crédito qualquer;1;500,00;1500,00
16/01/2026;Débito qualquer;2;-200,00;1300,00`
const txCsv2 = parseCSV(csvSignedValor)
expect('CSV valor positivo sem palavra-chave → ENTRADA', txCsv2[0]?.tipo, 'ENTRADA')
expect('CSV valor negativo → SAIDA', txCsv2[1]?.tipo, 'SAIDA')

// ─── Teste: distribuição de lucros / IR ───────────────────────────────────────

expect('Limite isenção R$ 50.000', LIMITE_DISTRIBUICAO_ISENTA, 50000)
expect('Termos: Distribuição Isenta', STATUS_DISTRIBUICAO.ISENTA, 'Distribuição Isenta')
expect('Termos: Distribuição Tributada', STATUS_DISTRIBUICAO.TRIBUTADA, 'Distribuição Tributada')
expect('IR R$ 30.000 (≤ limite) → 0', calcularIrDevido(30000), 0)
expect('IR R$ 50.000 (= limite) → 0', calcularIrDevido(50000), 0)
// R$ 150.000 → bruto 166.666,67 → IR 16.666,67
expect('IR R$ 150.000 → R$ 16.666,67', calcularIrDevido(150000), 16666.67)
// R$ 85.495,48 → bruto 94.994,98 → IR 9.499,50
expect('IR R$ 85.495,48 → R$ 9.499,50', calcularIrDevido(85495.48), 9499.50)

// ─── Teste: detecção de investimento automático ───────────────────────────────

expect('Detecta rendimento (Itaú)', isRendimentoAplicacao('RENDIMENTOS REND PAGO'), true)
expect('Detecta rendimento generic', isRendimentoAplicacao('RENDIMENTO APLIC FINANCEIRA'), true)
expect('Detecta resgate (Itaú)', isResgateAplicacao('RES APLIC AUT MAIS'), true)
expect('Detecta resgate (Bradesco)', isResgateAplicacao('RESGATE DE APLICACAO'), true)
expect('Não classifica PIX como investimento', isInvestimentoAutomatico('PIX RECEBIDO João'), false)
expect('Detecta repasse Cielo', isRecebimentoCartao('TED CIELO LIQUIDACAO'), true)
expect('Detecta repasse Rede', isRecebimentoCartao('CRED REDECARD'), true)
expect('Não classifica PIX como repasse de cartão', isRecebimentoCartao('PIX RECEBIDO'), false)

// ─── Teste: hash sha256 determinístico ────────────────────────────────────────

const buf1 = Buffer.from('conteúdo do arquivo de teste')
const buf2 = Buffer.from('conteúdo do arquivo de teste')
const buf3 = Buffer.from('conteúdo diferente')
expect('SHA-256 mesmo conteúdo → mesmo hash', hashBuffer(buf1), hashBuffer(buf2))
expect('SHA-256 conteúdos diferentes → hashes diferentes', hashBuffer(buf1) === hashBuffer(buf3), false)
expect('SHA-256 length 64 (hex)', hashBuffer(buf1).length, 64)

// ─── Teste 2: detectarTipoLote ────────────────────────────────────────────────

async function escreverTmp(nome: string, conteudo: string | Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lote-test-'))
  const p = path.join(dir, nome)
  await fs.writeFile(p, conteudo)
  return p
}

async function rodarDetect() {
  // OFX
  const pOfx = await escreverTmp('extrato.ofx', ofxFormatado)
  const r1 = await detectarTipoLote({ originalname: 'extrato.ofx', path: pOfx })
  expect('Detect OFX', r1.tipo, 'extrato_ofx')

  // CSV genérico (sem cabeçalho cartão/IAZAN)
  const pCsv = await escreverTmp('extrato.csv', 'Data;Histórico;Documento;Valor;Saldo\n01/01/2026;TED;1234;-100,00;9000,00')
  const r2 = await detectarTipoLote({ originalname: 'extrato.csv', path: pCsv })
  expect('Detect CSV genérico', r2.tipo, 'extrato_csv')

  // CSV com cabeçalho de cartão
  const pCsvCard = await escreverTmp('cielo.csv',
    'Data Venda;Bandeira;Valor Bruto;Valor Líquido\n01/01/2026;VISA;100,00;98,00')
  const r3 = await detectarTipoLote({ originalname: 'cielo.csv', path: pCsvCard })
  expect('Detect CSV de cartão', r3.tipo, 'cartao')

  // XML — não suportado
  const pXml = await escreverTmp('nf.xml', '<NFSe><emit><CNPJ>30776724000192</CNPJ></emit></NFSe>')
  const r4 = await detectarTipoLote({ originalname: 'nf.xml', path: pXml })
  expect('Detect XML (não suportado)', r4.tipo, 'desconhecido')

  // Extensão estranha
  const pTxt = await escreverTmp('outro.txt', 'qualquer coisa')
  const r5 = await detectarTipoLote({ originalname: 'outro.txt', path: pTxt })
  expect('Detect extensão não suportada', r5.tipo, 'desconhecido')
}

;(async () => {
  console.log('── extractCNPJfromOFX ──')
  console.log()
  console.log('── detectarTipoLote ──')
  await rodarDetect()
  console.log()
  if (falhas > 0) {
    console.error(`${falhas} teste(s) falharam`)
    process.exit(1)
  }
  console.log('✓ Todos os smoke tests passaram')
  process.exit(0)
})()
