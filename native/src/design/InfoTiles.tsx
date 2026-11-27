// Labelled facts in a grid of tiles. A big tile always says what its value is (the owner's
// rule: no unlabelled figure); a value that is not known yet shows a dash, never a blank.
import type { ComponentType, ReactNode } from 'react';
import { View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { AppText } from './AppText';
import { useTheme } from './theme';

export interface InfoTile { label: string; value: ReactNode; icon?: ComponentType<LucideProps>; accessibilityValue?: string }

export function InfoTiles({ tiles, columns = 2 }: { tiles: InfoTile[]; columns?: number }) {
  // An odd count in two columns ends in a row of three, never one stretched tile.
  if (columns === 2 && tiles.length >= 5 && tiles.length % 2 === 1) {
    return <View style={{ gap: 8 }}><InfoTiles tiles={tiles.slice(0, -3)} /><InfoTiles tiles={tiles.slice(-3)} columns={3} /></View>;
  }
  return <TileGrid tiles={tiles} columns={columns} />;
}

function TileGrid({ tiles, columns }: { tiles: InfoTile[]; columns: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {tiles.map(tile => {
        const Icon = tile.icon;
        const text = typeof tile.value === 'string' || typeof tile.value === 'number' ? String(tile.value) : null;
        return (
          <View key={tile.label} accessible accessibilityLabel={`${tile.label}: ${tile.accessibilityValue ?? text ?? ''}`}
            style={{ flexBasis: `${100 / columns - 3}%`, flexGrow: 1, minHeight: 64, padding: 10, gap: 4, borderRadius: t.radius.md,
              backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {Icon ? <Icon size={13} color={t.c.fgMuted} /> : null}
              <AppText variant="caption" tone="muted" numberOfLines={1}>{tile.label}</AppText>
            </View>
            {text !== null ? <AppText variant="callout" weight="semibold" numberOfLines={2}>{text}</AppText> : tile.value}
          </View>
        );
      })}
    </View>
  );
}
