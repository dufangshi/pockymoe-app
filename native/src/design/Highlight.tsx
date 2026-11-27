// Text with the words of a search marked (accent wash, semibold), case-insensitive. A long
// snippet starts shortly before the first match so the match is visible in two lines.
import { Fragment } from 'react';
import { AppText, type AppTextProps } from './AppText';
import { useTheme } from './theme';
import { splitMatches } from './matches';

export { aroundMatch, splitMatches } from './matches';

export function Highlight({ text, query, ...rest }: AppTextProps & { text: string; query: string }) {
  const t = useTheme();
  return (
    <AppText {...rest}>
      {splitMatches(text, query).map((p, i) => p.hit
        ? <AppText key={i} variant={rest.variant} weight="semibold" color={t.c.fg} style={{ backgroundColor: t.c.accentSoft }}>{p.text}</AppText>
        : <Fragment key={i}>{p.text}</Fragment>)}
    </AppText>
  );
}
