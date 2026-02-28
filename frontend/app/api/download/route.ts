export const runtime = 'nodejs'
export const maxDuration = 300

// GET /api/download?url=...&format_id=...
// Used by <a href> for direct file downloads — browser streams natively, no RAM buffering.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url') || ''
  const format_id = searchParams.get('format_id') || 'direct'
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const backendUrl = new URL(`${apiUrl}/api/download`)
  backendUrl.searchParams.set('url', url)
  backendUrl.searchParams.set('format_id', format_id)

  const res = await fetch(backendUrl.toString())

  if (!res.ok) {
    return new Response(await res.text(), { status: res.status })
  }

  const headers: Record<string, string> = {
    'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Disposition': res.headers.get('Content-Disposition') || 'attachment',
  }
  const cl = res.headers.get('Content-Length')
  if (cl) headers['Content-Length'] = cl

  return new Response(res.body, { headers })
}

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
