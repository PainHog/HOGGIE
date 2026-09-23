/** Renders a bundled game-icons.net silhouette (CC BY 3.0) as a tintable vector. */
import Svg, { Path } from "react-native-svg";
import { ICON_VIEWBOX, ICONS, type IconDef, type IconName } from "./icons.generated";

export type { IconName };

export function SvgIcon({
  name,
  size = 24,
  color = "#e8e0d0",
  opacity,
}: {
  name: IconName;
  size?: number;
  color?: string;
  opacity?: number;
}) {
  const def: IconDef | undefined = ICONS[name];
  if (!def) return null;
  return (
    <Svg width={size} height={size} viewBox={ICON_VIEWBOX} opacity={opacity}>
      {def.paths.map((p, i) => (
        <Path key={i} d={p.d} fill={color} fillRule={p.fillRule === "evenodd" ? "evenodd" : "nonzero"} />
      ))}
    </Svg>
  );
}
