import Script from 'next/script';

export default function Home() {
  return (
    <>
      <div id="app"></div>
      <Script
        src="https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js"
        strategy="beforeInteractive"
      />
      <Script type="module" src="/app.js" strategy="afterInteractive" />
    </>
  );
}
