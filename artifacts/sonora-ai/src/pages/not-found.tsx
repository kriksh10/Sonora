export default function NotFound() {
  const home = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return (
    <main className="missing-page">
      <img src={`${home === '/' ? '' : home}/logo.svg`} alt="Sonora AI" width={48} height={48} />
      <h1>Page not found</h1>
      <p>That link doesn’t match a Sonora AI page. Head home and pick up where you left off.</p>
      <a href={home}>Back to Sonora AI</a>
    </main>
  );
}