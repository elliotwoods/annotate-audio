import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../src/index.css';

// Absolute base for OG/Twitter image URLs (crawlers require absolute URLs).
// Prefer an explicit site URL, then Vercel's production domain, then localhost.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000');

const title = 'Cue Timeline';
const description =
  'Browser-based timeline editor for planning show, lighting, stage, and AV cues against a piece of music — bar/beat grid, ranged and point cues, and automation curves.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: title,
  openGraph: {
    type: 'website',
    siteName: title,
    title,
    description,
    url: '/',
    images: [
      {
        url: '/og-image.png',
        width: 2319,
        height: 1080,
        alt: 'The Cue Timeline editor: an audio waveform with a bar/beat grid and stacked rows of coloured cues.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og-image.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
