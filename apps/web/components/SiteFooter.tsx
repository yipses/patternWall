import styles from './SiteFooter.module.css';
import { BuildStamp } from './BuildStamp';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span className={styles.name}>PatternWall</span>
        <BuildStamp className={styles.build} commitClassName={styles.commit} />
      </div>
    </footer>
  );
}
