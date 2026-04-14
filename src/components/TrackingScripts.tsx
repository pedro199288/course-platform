import { useEffect } from "react";

type TrackingScriptsProps = {
  gaTrackingId?: string | null;
  fbPixelId?: string | null;
};

/**
 * Injects Google Analytics and Facebook Pixel scripts into the document head.
 * Only injects when the corresponding ID is provided.
 * Scripts are cleaned up on unmount to avoid duplicates.
 */
export function TrackingScripts({ gaTrackingId, fbPixelId }: TrackingScriptsProps) {
  useEffect(() => {
    if (!gaTrackingId) return;

    const scriptTag = document.createElement("script");
    scriptTag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaTrackingId)}`;
    scriptTag.async = true;
    document.head.appendChild(scriptTag);

    const inlineScript = document.createElement("script");
    inlineScript.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaTrackingId}');`;
    document.head.appendChild(inlineScript);

    return () => {
      document.head.removeChild(scriptTag);
      document.head.removeChild(inlineScript);
    };
  }, [gaTrackingId]);

  useEffect(() => {
    if (!fbPixelId) return;

    const script = document.createElement("script");
    script.textContent = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${fbPixelId}');fbq('track','PageView');`;
    document.head.appendChild(script);

    const noscript = document.createElement("noscript");
    const img = document.createElement("img");
    img.height = 1;
    img.width = 1;
    img.style.display = "none";
    img.src = `https://www.facebook.com/tr?id=${encodeURIComponent(fbPixelId)}&ev=PageView&noscript=1`;
    noscript.appendChild(img);
    document.head.appendChild(noscript);

    return () => {
      document.head.removeChild(script);
      document.head.removeChild(noscript);
    };
  }, [fbPixelId]);

  return null;
}
