import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "Payment Issues Dashboard",
  description: "Manage and review payment processing issues",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <header className="border-b bg-background">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold">
              Payment Issues
            </Link>
            <nav className="flex gap-6">
              <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
                Issues
              </Link>
              <Link href="/analytics" className="text-sm text-muted-foreground hover:text-foreground">
                Analytics
              </Link>
              <Link href="/audit-logs" className="text-sm text-muted-foreground hover:text-foreground">
                Audit Logs
              </Link>
            </nav>
          </div>
        </header>
        <main className="container mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
