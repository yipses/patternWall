import type { Metadata } from 'next';
import Link from 'next/link';
import { uiStyles as ui } from '../../components/ui';
import styles from './setup.module.css';

export const metadata: Metadata = {
  title: 'Automate',
  description:
    'Export thirty wallpapers, put them in a Photos album, and let a Shortcuts personal automation set a different one each morning. Including an honest account of what iOS will and will not let a third-party app do.',
};

export default function SetupPage() {
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.kicker}>Automate</div>
        <h1 className={styles.title}>A different wallpaper every morning, without an app.</h1>
        <p className={styles.standfirst}>
          Export thirty variations, drop them into a Photos album, and let Shortcuts pick one at random on a schedule. It
          takes about five minutes to set up and then never needs touching again.
        </p>
      </div>

      <div className={styles.body}>
        <div className={`${styles.callout} ${styles.calloutWarn}`}>
          <div className={styles.calloutTitle}>Read this first: nothing here can be automatic</div>
          <p style={{ marginBottom: 0 }}>
            iOS has no public API that lets a third-party app set your wallpaper. There is no permission to ask for and no
            entitlement to apply for; the capability simply is not exposed, and any app claiming otherwise is either
            handing you a file to set manually or is not doing what it says. The sanctioned route is Shortcuts, which is
            Apple&rsquo;s own automation app, and which does have a wallpaper action. So PatternWall gives you the files
            and Shortcuts does the setting. That is the whole trick, and it is a real limitation rather than a design
            choice.
          </p>
        </div>

        <div className={`${styles.callout}`}>
          <div className={styles.calloutTitle}>How the instructions below were checked</div>
          <p>
            Apple moves labels around between iOS releases, so these steps were written against Apple&rsquo;s own Shortcuts
            User Guide rather than from memory. <strong>An important caveat:</strong> the machine this page was written on
            could not open <code>support.apple.com</code> directly — outbound requests to it are blocked by a network
            policy — so the guide was consulted through search results that quote it, not by reading the pages in full.
          </p>
          <p>
            Where a label below is in <strong>bold</strong>, it appears in Apple&rsquo;s documentation as quoted in those
            results. Where a label is marked <em>(check the label on your device)</em>, it comes from the community rather
            than from Apple, and the wording may differ on your iOS version. Nothing here is invented; a couple of things
            are simply less certain than the rest, and are marked as such.
          </p>
          <ul className={styles.sources}>
            <li>
              Shortcuts User Guide — <em>Create a new personal automation</em>, <em>Intro to personal automation</em>,{' '}
              <em>Event triggers</em>, <em>Enable or disable a personal automation</em>
            </li>
            <li>
              Shortcuts User Guide — <em>Intro to Find and Filter actions</em>, <em>Add filter parameters to Find and Filter
              actions</em>
            </li>
            <li>Apple Support — <em>What&rsquo;s new in Shortcuts</em>, which names the Set Wallpaper Photo action</li>
          </ul>
        </div>

        <h2>1. Export a batch</h2>
        <p>
          Open any pattern, get it to a configuration you like, then go to the <strong>Export</strong> tab and use{' '}
          <strong>Export 30 as a zip</strong>. That renders the same configuration with thirty different seeds — the same
          palette, the same parameters, thirty different arrangements — and downloads them as one archive. Pick your
          device from the preset list first so the files come out at your panel&rsquo;s pixel size, and leave the 8% bleed
          switched on so iOS&rsquo;s parallax zoom never finds an unpainted edge.
        </p>
        <p>
          Thirty is a deliberate number: it is enough that you will not notice the loop inside a month, and small enough
          that the zip stays around ten megabytes at PNG-8.
        </p>
        <div className={styles.cta}>
          <Link className={`${ui.btn} ${ui.primary}`} href="/">
            Choose a pattern
          </Link>
        </div>

        <h2>2. Get them into an album</h2>
        <ol className={styles.steps}>
          <li className={styles.step}>
            Unzip the archive. On a Mac, AirDrop the folder of PNGs to your iPhone and choose to save them to Photos; from
            iCloud Drive or Files on the phone itself, select them all and use <strong>Save Images</strong>.
          </li>
          <li className={styles.step}>
            In Photos, select the thirty imported images, then add them to a <strong>New Album</strong> and call it{' '}
            <code>PatternWall</code>. The name matters only in that the shortcut has to point at the same one.
          </li>
          <li className={styles.step}>
            Keep the album to just these images. The shortcut picks at random from whatever is in it, so a stray screenshot
            becomes a wallpaper eventually.
          </li>
        </ol>

        <h2>3. Build the shortcut</h2>
        <p>
          In the Shortcuts app, on the <strong>Shortcuts</strong> tab, create a new shortcut and add three actions in this
          order. Search the action list by name; every one of these is built in and needs no third-party app.
        </p>

        <div className={styles.action}>
          <span>1</span> Find Photos
          <br />
          <span>&nbsp;&nbsp;&nbsp;</span>where <strong>Album</strong> is <strong>PatternWall</strong>
          <br />
          <span>&nbsp;&nbsp;&nbsp;</span>
          <strong>Sort by</strong> Random
          <br />
          <span>&nbsp;&nbsp;&nbsp;</span>
          <strong>Limit</strong> 1 photo
          <br />
          <br />
          <span>2</span> Set Wallpaper Photo
          <br />
          <span>&nbsp;&nbsp;&nbsp;</span>to the <strong>Photos</strong> output of step 1
        </div>

        <h3>About the filter row</h3>
        <p>
          Apple&rsquo;s guide describes Find and Filter actions as arriving with a default filter string — its example is{' '}
          <strong>&ldquo;Album is All Photos&rdquo;</strong> — and says you tap any term in that string to change it. So
          tap <strong>All Photos</strong> and choose your <code>PatternWall</code> album. The same guide describes tapping{' '}
          <strong>Sort by</strong>, choosing from the list, and then setting the <strong>Order</strong> parameter that
          appears; choose Random, which needs no order. Finally set the limit to one photo, so the action hands a single
          image to the next step rather than all thirty.
        </p>

        <h3>About the wallpaper action</h3>
        <p>
          The action is called <strong>Set Wallpaper Photo</strong>. Apple&rsquo;s &ldquo;What&rsquo;s new in
          Shortcuts&rdquo; note describes it as setting photos for wallpapers using the current Lock Screen customisation
          model, and it can target the Lock Screen, the Home Screen, or both.
        </p>
        <p>
          Expand the action to see its options. Community write-ups consistently report three toggles worth turning off —{' '}
          <em>Show Preview (check the label on your device)</em>,{' '}
          <em>Crop to Subject (check the label on your device)</em> and{' '}
          <em>Legibility Blur (check the label on your device)</em>. A preview step turns an automation that was supposed
          to be silent into one that asks you to confirm every morning. Subject cropping will happily zoom into the
          middle of a pattern that was composed for the whole screen. And the legibility blur is the Home Screen
          softening iOS applies to help icon labels stand out — useful over a photograph, but it turns fine line work
          into mud, which is the entire reason the Home Screen variant in the Export tab raises contrast instead. None of
          these three labels could be confirmed against Apple&rsquo;s own documentation from here, so look at what your
          version actually says.
        </p>
        <p>
          Name the shortcut something you will recognise in a list — <code>PatternWall Morning</code> — and run it once
          from the Shortcuts app to check it does what you expect before you put it on a timer.
        </p>

        <h2>4. Put it on a schedule</h2>
        <p>
          Apple&rsquo;s guide describes personal automation as a way to run actions based on events such as time of day.
          Create one from the <strong>Automation</strong> tab:
        </p>
        <ol className={styles.steps}>
          <li className={styles.step}>
            Go to the <strong>Automation</strong> tab and start a new personal automation.
          </li>
          <li className={styles.step}>
            Choose the <strong>Time of Day</strong> trigger. Apple&rsquo;s event-triggers page describes it as triggering
            at a specific time, with a choice of which day or days it runs on. Pick a time you are reliably asleep or at
            least not looking at the screen, and set it to repeat daily.
          </li>
          <li className={styles.step}>
            Choose the <code>PatternWall Morning</code> shortcut as the thing to run.
          </li>
          <li className={styles.step}>
            Turn off <strong>Ask Before Running</strong>, then tap <strong>Don&rsquo;t Ask</strong> to confirm. This is
            the exact wording in Apple&rsquo;s &ldquo;Enable or disable a personal automation&rdquo; page, and it is what
            makes the automation run silently instead of sending you a notification to approve every morning. The same
            page notes that once this is off, the automation will not notify you when it is triggered.
          </li>
        </ol>

        <h2>If it does not work</h2>
        <ul>
          <li>
            <strong>It asks for confirmation every day.</strong> Either <strong>Ask Before Running</strong> is still on
            for the automation, or the wallpaper action is still showing its preview step. Both have to be off.
          </li>
          <li>
            <strong>The wallpaper is zoomed in.</strong> Subject cropping is on, or the exported file is not the same
            aspect ratio as your screen. Re-export with your device selected from the preset list.
          </li>
          <li>
            <strong>An edge shows when you tilt the phone.</strong> The bleed was off. Export again with the 8% bleed
            switch on, which renders the image larger than the screen on every side specifically to give the parallax
            somewhere to go.
          </li>
          <li>
            <strong>It sets the same image repeatedly.</strong> The sort is not set to Random, or the limit is not 1 and
            something downstream is taking the first result.
          </li>
          <li>
            <strong>Nothing happens at the scheduled time.</strong> Personal automations do not run while the phone is
            powered off, and a Time of Day automation that falls during a period when the device is off will not
            retroactively fire. Try a time when the phone is on and charging.
          </li>
        </ul>

        <h2>A note on honesty</h2>
        <p>
          This page is the least glamorous part of PatternWall and the most important one. A generative wallpaper studio
          that quietly implied it could change your wallpaper for you would be lying, and a studio that ignored the
          question entirely would be leaving you with a folder of PNGs and no idea what to do with them. Shortcuts is a
          genuinely good answer — it is Apple&rsquo;s own automation surface, it is on every phone, and once it is set up
          it is invisible. It just is not something an app can do on your behalf.
        </p>
      </div>
    </div>
  );
}
