export const runtime = 'nodejs'
export const maxDuration = 45

// Render's fromService gives a bare hostname; prepend https:// if needed
function getApiUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  return raw.startsWith('http') ? raw : `https://${raw}`
}

export async function POST(req: Request) {
  const body = await req.json()
  const apiUrl = getApiUrl()

  const res = await fetch(`${apiUrl}/api/info`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

  const data = await res.json()
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
