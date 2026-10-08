# Cloak design

The app is a compact Windows utility. Use near-black backgrounds and purple for selection and the immediate action. The installer shares the same CSS tokens, Button, Icon and Notice components.

| Token or geometry | Value                        | Use                                  |
| ----------------- | ---------------------------- | ------------------------------------ |
| Canvas            | `#090909`                    | Native client background.            |
| Surface           | `#121212`                    | Tiles and grouped configuration.     |
| Text              | `#f2f2f3`                    | Primary text.                        |
| Muted             | `#a1a1aa`                    | Secondary information.               |
| Accent            | `#b8a0fa`                    | Selection, focus and primary action. |
| Accent ink        | `#21143d`                    | Text on accent buttons.              |
| Body type         | Segoe UI Variable, Segoe UI  | Native text at 13 CSS px.            |
| App window        | 784 x 496, minimum 620 x 420 | Medium centered rectangle.           |
| Controls          | 34 to 36 px tall             | Consistent interaction size.         |
| Dropdown inset    | 12 px at the right           | Keep the arrow away from the edge.   |

Use a consistent Lucide icon family. Name ambiguous actions and expose accessible names on icon buttons. Place secondary settings in disclosures. Group fields and their Save button through proximity or a subtle shared background. Add a separator only when it marks a meaningful boundary; never surround an action with lines that obscure its scope.

Setup uses Folder, Repository and Ready icons connected by an accent track. Initialize that track at the current step without motion. Animate subsequent step changes. Dialog height follows content. Forms must not reserve a blank dashboard-sized area.

Motion follows actual state. Spring selection backgrounds and dialog entry; keep text transitions short. Respect the OS reduced-motion preference. Controls must remain understandable while animation is disabled. Retain focus through disclosures, menus and errors. Radix Select handles keyboard choice, focus return, scrolling and collision placement. Menus inside native dialogs must portal into that dialog's top layer.

Windows owns the native window corners. Do not add a renderer border or rounded outline over them. Glass was rejected for dense settings; keep their interior backgrounds solid.

## References

The owner supplied T3 Code Nightly as the near-black palette reference. Its palette source is [T3 Code](https://github.com/pingdotgg/t3code/blob/main/packages/shared/src/themePalettes.ts). The control behavior follows [Radix Select](https://www.radix-ui.com/primitives/docs/components/select). The owner's Ada design system informed restrained settings, native corners and a custom installer with real progress. The custom Cloak mark is original SVG artwork in `assets/mark.svg`. Personal screenshots and the curated repertoire are preserved in the owner's [skills repository](https://github.com/zF4ke/skills), not the public app.
