import { PrismaClient, Role, RegimeTributario } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed...')

  // Usuário admin ThinQi
  const adminHash = await bcrypt.hash('admin@thinqi2024', 10)
  const admin = await prisma.usuario.upsert({
    where: { email: 'admin@thinqi.com.br' },
    update: {},
    create: {
      nome: 'Admin ThinQi',
      email: 'admin@thinqi.com.br',
      senha_hash: adminHash,
      role: Role.ADMIN,
      empresa_id: null,
    },
  })
  console.log(`✅ Admin criado: ${admin.email}`)

  // Empresa de exemplo
  const empresa = await prisma.empresa.upsert({
    where: { cnpj: '12.345.678/0001-99' },
    update: {},
    create: {
      razao_social: 'Empresa Demo Ltda',
      cnpj: '12.345.678/0001-99',
      regime_tributario: RegimeTributario.SIMPLES_NACIONAL,
    },
  })
  console.log(`✅ Empresa criada: ${empresa.razao_social}`)

  // Usuário cliente vinculado à empresa
  const clienteHash = await bcrypt.hash('cliente@demo2024', 10)
  const cliente = await prisma.usuario.upsert({
    where: { email: 'cliente@demo.com.br' },
    update: {},
    create: {
      nome: 'João Demo',
      email: 'cliente@demo.com.br',
      senha_hash: clienteHash,
      role: Role.CLIENTE,
      empresa_id: empresa.id,
    },
  })
  console.log(`✅ Cliente criado: ${cliente.email}`)

  console.log('🎉 Seed concluído!')
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
