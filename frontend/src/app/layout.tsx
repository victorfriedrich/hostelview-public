import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { HostelDataProvider } from "./HostelDataContext";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Link previews need absolute image URLs: the deployed site's address.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Hostelview",
  description: "Discover hostels with the best ratings and prices",
  openGraph: {
    title: "Hostelview",
    description: "Discover hostels with the best ratings and prices",
    images: ["/images/flight.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hostelview",
    description: "Discover hostels with the best ratings and prices",
    images: ["/images/flight.png"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`app ${geistSans.variable} ${geistMono.variable} antialiased text-lg opacity-0 transition-opacity duration-300`}
      >
        <HostelDataProvider>
          {children}
        </HostelDataProvider>
        <Script id="show-body" strategy="afterInteractive">
          {`document.body.classList.remove('opacity-0')`}
        </Script>
      </body>
    </html>
  );
}
