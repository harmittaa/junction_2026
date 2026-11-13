import type { Metadata } from "next";
import tokens from "../../docs/design-tokens.json";
import "./globals.css";

export const metadata: Metadata = { title: "Sponky — your money, a little clearer", description: "A conversational money coach with synthetic historical data." };
function variables(object: object, prefix = ""): string {
  return Object.entries(object).map(([key, value]) => typeof value === "object" ? variables(value, `${prefix}${key}-`) : `--${prefix}${key}:${value};`).join("");
}
const themeCSS = `:root{${variables(tokens.color.light)}${Object.entries(tokens.color.brand).map(([k, v]) => `--brand-${k}:${v.value};`).join("")}}[data-theme=dark]{${variables(tokens.color.dark)}}`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><style>{themeCSS}</style></head><body>{children}</body></html>;
}
