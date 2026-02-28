export const runtime = 'nodejs'
export const maxDuration = 300

function getApiUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  return raw.startsWith('http') ? raw : `https://${raw}`
}

async function proxyDownload(backendUrl: string) {
  const res = await fetch(backendUrl)

  if (!res.ok) {
    return new Response(await res.text(), { status: res.status })
  }

  const contentType = res.headers.get('Content-Type') || 'application/octet-stream'
  const contentDisposition = res.headers.get('Content-Disposition') || 'attachment'
  const contentLength = res.headers.get('Content-Length')

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition,
  }
  if (contentLength) headers['Content-Length'] = contentLength

  // Manually pipe the response body through a new ReadableStream
  // to ensure it streams correctly in Next.js Node.js runtime.
  const reader = res.body?.getReader()
  if (!reader) {
    return new Response('No response body', { status: 502 })
  }

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
        } else {
          controller.enqueue(value)
        }
      } catch {
        controller.close()
      }
    },
    cancel() {
      reader.cancel()
    },
  })

  return new Response(stream, { headers })
}

// GET /api/download?url=...&format_id=...
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url') || ''
  const format_id = searchParams.get('format_id') || 'direct'
  const apiUrl = getApiUrl()

  const backendUrl = new URL(`${apiUrl}/api/download`)
  backendUrl.searchParams.set('url', url)
  backendUrl.searchParams.set('format_id', format_id)

  return proxyDownload(backendUrl.toString())
}

export async function POST(req: Request) {
  const body = await req.json()
  const apiUrl = getApiUrl()

  const backendUrl = new URL(`${apiUrl}/api/download`)
  backendUrl.searchParams.set('url', body.url)
  backendUrl.searchParams.set('format_id', body.format_id || 'best')

  return proxyDownload(backendUrl.toString())
}
