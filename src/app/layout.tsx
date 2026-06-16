import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://guitarllama-fretboard-memorizer.github.io'),
  title: "GuitarLlama | Fretboard Memorizer",
  description: "The ultimate guitar fretboard memorization app. Master the guitar neck, learn fret notes instantly, and improve your neural stability with our interactive fret note memorizer.",
  keywords: "guitar fretboard memorization app, guitar fret note memorizer app, learn guitar notes, fretboard trainer, guitar neck master, interactive guitar fretboard, spaced repetition guitar",
  openGraph: {
    title: "GuitarLlama | Fretboard Memorizer",
    description: "The ultimate guitar fretboard memorization app. Master the guitar neck and learn fret notes instantly.",
    type: "website",
    url: "https://guitarllama-fretboard-memorizer.github.io",
    images: [
      {
        url: "/logo.png",
        width: 800,
        height: 800,
        alt: "GuitarLlama Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "GuitarLlama | Fretboard Memorizer",
    description: "The ultimate guitar fretboard memorization app. Master the guitar neck and learn fret notes instantly.",
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
