import { useEffect } from "react";

interface StorefrontBrandingProps {
  primaryColor: string | null;
  accentColor: string | null;
  faviconUrl: string | null;
  hidesPlatformBranding?: boolean;
}

/**
 * Injects tenant branding into the storefront:
 * - CSS custom properties for primary/accent colors
 * - Dynamic favicon when configured
 */
export function StorefrontBranding({
  primaryColor,
  accentColor,
  faviconUrl,
  hidesPlatformBranding,
}: StorefrontBrandingProps) {
  useEffect(() => {
    const root = document.documentElement;
    const cleanups: (() => void)[] = [];

    if (primaryColor) {
      root.style.setProperty("--tenant-primary", primaryColor);
      cleanups.push(() => root.style.removeProperty("--tenant-primary"));
    }

    if (accentColor) {
      root.style.setProperty("--tenant-accent", accentColor);
      cleanups.push(() => root.style.removeProperty("--tenant-accent"));
    }

    if (faviconUrl) {
      const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      const existingHref = existing?.href;
      const link = existing ?? document.createElement("link");
      if (!existing) {
        link.rel = "icon";
        document.head.appendChild(link);
        cleanups.push(() => link.remove());
      } else {
        cleanups.push(() => {
          link.href = existingHref ?? "";
        });
      }
      link.href = faviconUrl;
    }

    if (hidesPlatformBranding) {
      root.classList.add("white-label");
      cleanups.push(() => root.classList.remove("white-label"));
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [primaryColor, accentColor, faviconUrl, hidesPlatformBranding]);

  return null;
}
