import { SiteChrome } from '../../components/SiteChrome';

/**
 * The chrome every page of the site proper carries.
 *
 * This used to be the root layout, and moved down here when `/m` arrived. That
 * route is the preview and nothing else — no header, no footer, no page to
 * scroll — so it cannot live under a layout that draws them. A route group
 * does not appear in the URL, so `/`, `/collected`, `/setup` and `/p/<id>` are
 * exactly where they were.
 *
 * What stays in the root layout is what every route needs whatever it looks
 * like: `<html>`, `<body>`, the stylesheet and the render bridge.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
