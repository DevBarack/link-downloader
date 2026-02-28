export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const body = await req.json()
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const res = await fetch(`${apiUrl}/api/download`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const err = await res.text()
    return new Response(err, { status: res.status })
  }

  // Forward streaming response with relevant headers
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream'
  const contentDisposition = res.headers.get('Content-Disposition') || 'attachment'
  const contentLength = res.headers.get('Content-Length')

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition,
  }
  if (contentLength) headers['Content-Length'] = contentLength

  return new Response(res.body, { status: 200, headers })
}
