import Image from "next/image";

import styles from "./BrandMark.module.css";

/**
 * The one brand mark for the app. Swappable by design: to replace the
 * wordmark, swap the static asset at public/brand/sika-wordmark.svg (same
 * path) and touch no code. The current asset is the Sika wordmark extracted
 * from the supplied brand card — the lettering source (Ahsing) is used only
 * inside this static asset, never as an application font.
 */
export function BrandMark() {
  return (
    <Image
      src="/brand/sika-wordmark.svg"
      alt="Sika"
      width={872}
      height={280}
      priority
      className={styles.mark}
    />
  );
}
