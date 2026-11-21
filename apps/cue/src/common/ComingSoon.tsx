import type { ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { ComingSoonCard, ComingSoonPill, type IconName } from "@theatre-suite/ui";

/** "Coming with Cue x.y" (a small dashed pill), as in 02_design.md "Parte non ancora disponibile". */
export function SoonPill({ version }: { version: string }) {
  const t = useT();
  return <ComingSoonPill label={t("Coming with Cue {v}", { v: version })} />;
}

/** "Part not yet available": the shared `ComingSoonCard` with the Cue version text. `title`, `about` and `children` come already translated. */
export function ComingSoon({
  icon,
  version,
  title,
  about,
  children,
  compact,
}: {
  icon: IconName;
  version: string;
  title: string;
  about: string[];
  children?: ReactNode;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <ComingSoonCard icon={icon} label={t("Coming with Cue {v}", { v: version })} title={title} items={about} compact={compact}>
      {children}
    </ComingSoonCard>
  );
}
