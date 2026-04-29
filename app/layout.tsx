import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Video Prediction Quiz',
  description: 'Upload a video, generate prediction moments, and test your intuition.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
