import type { Metadata } from "next"
import Script from "next/script"
import "./globals.css"
import { TooltipProvider } from "@/components/ui/tooltip"

export const metadata: Metadata = {
  title: "309agnet",
  description: "ChatGPT-style MVP with local persistence",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="antialiased">
        <Script id="system-theme" strategy="beforeInteractive">
          {`(() => {
            const root = document.documentElement;
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            const apply = () => root.classList.toggle('dark', mq.matches);
            apply();
            mq.addEventListener?.('change', apply);
          })();`}
        </Script>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  )
}
