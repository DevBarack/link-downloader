'use client'

import './globals.css'
import { useEffect } from 'react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error)
    }
  }, [])

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#6366f1" />
        <meta name="description" content="Download any media or file from a link" />

        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LinkDrop" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />

        <title>LinkDrop</title>
      </head>
      <body className="min-h-screen bg-[#0f172a] safe-top safe-bottom">
        {children}
      </body>
    </html>
  )
}
