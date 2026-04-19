import 'dotenv/config'
import { uploadPDF, downloadPDF, deletePDF } from '../src/utils/storage'

async function main() {
  // Cada upload usa key única (com timestamp) — política do controller real
  const mkKey = () => `smoke/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`

  const v1 = Buffer.from('%PDF-1.4\nversao 1\n')
  const v2 = Buffer.from('%PDF-1.4\nversao 2 bem maior\n')

  console.log('1) Upload v1 em key A')
  const keyA = mkKey()
  await uploadPDF(keyA, v1)

  console.log('2) Download key A retorna v1')
  const got1 = await downloadPDF(keyA)
  if (!got1 || got1.toString() !== v1.toString()) throw new Error('esperava v1')
  console.log('   ok')

  console.log('3) Simula replace: upload v2 em key B + delete key A')
  const keyB = mkKey()
  await uploadPDF(keyB, v2)
  await deletePDF(keyA)

  console.log('4) Download key B retorna v2')
  const got2 = await downloadPDF(keyB)
  if (!got2 || got2.toString() !== v2.toString())
    throw new Error(`esperava v2, recebeu: ${got2?.toString()}`)
  console.log('   ok — versionamento por key unica funcionou')

  console.log('5) Download key inexistente retorna null')
  const missing = await downloadPDF('nao/existe.pdf')
  if (missing !== null) throw new Error('esperava null')
  console.log('   ok')

  console.log('6) Delete final (key B)')
  await deletePDF(keyB)

  console.log('\nSMOKE TEST PASSOU ✓')
}

main().catch(err => {
  console.error('FALHOU:', err.message)
  process.exit(1)
})
