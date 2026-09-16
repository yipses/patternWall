import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

/**
 * Header, skip link, main landmark, footer.
 *
 * A component rather than only a layout, because two routes need it that are
 * not under the `(site)` group: `not-found` and `error` have to sit at the app
 * root for Next to use them as the global 404 and error boundary, and they
 * would otherwise render bare. The build stamp lives in the footer, so "every
 * page carries a stamp" depends on this being on all of them.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="pw-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      {/* tabIndex -1 so the skip link actually moves focus. Without it the
          hash changes and the next Tab continues from wherever focus already
          was, which is the header the link exists to skip. */}
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
