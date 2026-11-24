# Design tokens

Semantic tokens live in `mobile/src/lib/theme.tsx` (`LIGHT` = Pearl Lavender, `DARK` = Midnight Plum).
Choice is System / Light / Dark, persisted in SecureStore, default System.

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | #F3F0F7 | #14111C | App background |
| surface | #FAF7FC | #211A2D | Raised cards, composer |
| text | #20192B | #F3EDF8 | Primary text |
| text2 | #625A6C | #BAB0C7 | Secondary text |
| accent | #5438C3 | #B9A5FF | Primary actions (text on it: #FFFFFF / #14111C) |
| unread | #F2A93B | #F5B451 | Count badges only, always with a number |
| error | #C0392B | #FF8A80 | Failed, destructive |

Measured WCAG contrast (computed, not estimated):

| Pair | Ratio |
|---|---|
| text on bg, light | 15.07 |
| text2 on bg, light | 5.82 |
| white on accent, light | 7.69 |
| ink on unread, light | 8.51 |
| text on bg, dark | 16.22 |
| text2 on bg, dark | 8.98 |
| #14111C on accent, dark | 8.78 |
| #14111C on unread, dark | 10.23 |

Targets: 44 pt minimum touch size (`HIT` in `components/ui.tsx`), 16 pt gutters, 16 pt card radius.
