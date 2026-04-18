// Em produção usa a URL do backend (Railway); em dev usa o proxy do Vite
const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

function getToken(): string | null {
  return localStorage.getItem('thinqi_token')
}

function getRefresh(): string | null {
  return localStorage.getItem('thinqi_refresh')
}

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

async function tryRefresh(): Promise<string | null> {
  const refreshToken = getRefresh()
  if (!refreshToken) return null

  if (isRefreshing) {
    // Enfileira quem está esperando o refresh terminar
    return new Promise((resolve) => {
      refreshQueue.push(resolve)
    })
  }

  isRefreshing = true
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!res.ok) return null

    const data = await res.json() as { accessToken: string; refreshToken: string }
    localStorage.setItem('thinqi_token', data.accessToken)
    localStorage.setItem('thinqi_refresh', data.refreshToken)

    // Desbloqueia todos que estavam esperando
    refreshQueue.forEach((cb) => cb(data.accessToken))
    refreshQueue = []

    return data.accessToken
  } catch {
    return null
  } finally {
    isRefreshing = false
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const isFormData = options.body instanceof FormData

  const buildHeaders = (tok: string | null): Record<string, string> => ({
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  })

  let res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(token) })

  // Token expirado → tenta refresh silencioso uma vez
  if (res.status === 401) {
    const newToken = await tryRefresh()

    if (newToken) {
      // Retenta com o novo token
      res = await fetch(`${BASE}${path}`, { ...options, headers: buildHeaders(newToken) })
    }

    // Se ainda 401, desloga
    if (res.status === 401) {
      localStorage.removeItem('thinqi_token')
      localStorage.removeItem('thinqi_refresh')
      window.location.href = '/'
      return undefined as T
    }
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()

  // Resposta vazia com status de erro
  if (!text) {
    if (!res.ok) throw new Error(`Erro ${res.status} — resposta vazia do servidor`)
    return undefined as T
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Resposta inválida do servidor (${res.status})`)
  }

  if (!res.ok) {
    throw new Error(data?.['error'] as string ?? data?.['message'] as string ?? `Erro ${res.status}`)
  }

  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
  // Download de arquivos binários (PDF, XLSX) — usa a mesma base URL do backend
  downloadBlob: async (path: string): Promise<Blob> => {
    const token = getToken()
    const res = await fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`Erro ao baixar arquivo (${res.status})`)
    return res.blob()
  },
}
