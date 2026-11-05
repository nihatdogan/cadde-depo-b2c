// `/` is served from index.html before rewrites run. This sends the homepage
// through the SEO function so the raw HTML includes product links and meta tags.
export const config = {
  matcher: ['/', '/index.html'],
};

export default function middleware(request) {
  const url = new URL(request.url);
  url.pathname = '/api/home';
  url.search = '';
  return fetch(url.toString(), {
    method: request.method,
    headers: request.headers,
  });
}
