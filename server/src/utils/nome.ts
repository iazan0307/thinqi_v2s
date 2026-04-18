/**
 * Utilitários de comparação de nomes para matching de sócios.
 */

/** Normaliza string: minúsculas, sem acentos, sem caracteres especiais */
export function normalizarNome(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z\s]/g, ' ')       // mantém só letras e espaços
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Palavras de baixo valor para matching de nomes (preposições, artigos).
 * Ignoradas no cálculo de similaridade.
 */
const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os'])

function palavrasRelevantes(nome: string): string[] {
  return normalizarNome(nome)
    .split(' ')
    .filter(p => p.length > 1 && !STOPWORDS.has(p))
}

/**
 * Calcula score de similaridade de nome entre o sócio cadastrado e um texto de transação.
 *
 * Estratégia em camadas:
 *   1. Se primeiro + último nome do sócio ambos aparecem no texto → 80 pts
 *   2. Proporção de palavras relevantes encontradas → até 75 pts
 *   3. Pelo menos 2 palavras relevantes encontradas → mínimo 55 pts (quando 2+ matches)
 *
 * Retorna 0 se nenhuma palavra relevante for encontrada.
 */
export function scoreNome(nomesSocio: string, textoTransacao: string): number {
  const palavrasSocio = palavrasRelevantes(nomesSocio)
  if (palavrasSocio.length === 0) return 0

  const textoNorm = normalizarNome(textoTransacao)

  const encontradas = palavrasSocio.filter(p => textoNorm.includes(p))
  if (encontradas.length === 0) return 0

  const proporcao = encontradas.length / palavrasSocio.length

  // Caso especial: primeiro e último nome ambos presentes (alto valor)
  const primeiro = palavrasSocio[0]
  const ultimo   = palavrasSocio[palavrasSocio.length - 1]
  const temPrimeiroEUltimo =
    primeiro !== ultimo &&
    textoNorm.includes(primeiro) &&
    textoNorm.includes(ultimo)

  if (temPrimeiroEUltimo && proporcao >= 0.5) return 80
  if (proporcao === 1) return 75                  // todos os nomes encontrados
  if (proporcao >= 0.67) return 68                // 2 de 3, ou 3 de 4, etc.
  if (encontradas.length >= 2) return 55          // pelo menos 2 palavras
  if (encontradas.length === 1 && palavrasSocio.length === 1) return 60 // nome único

  return 0 // apenas 1 palavra de um nome composto → muito ambíguo
}
