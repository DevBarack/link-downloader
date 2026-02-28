/** @type {import('next').NextConfig} */
module.exports = {
  // No output: 'export' — Node server required for streaming proxy
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
  // Proxy /dl to backend — bypasses App Router entirely so Safari
  // gets clean headers (no RSC/vary) and downloads files correctly.
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    return [
      {
        source: '/dl',
        destination: `${api}/api/download`,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
}
