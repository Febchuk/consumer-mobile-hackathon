import { Platform, TextStyle } from "react-native";

export const SYS = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Helvetica Neue", system-ui, sans-serif',
  default: undefined,
});

export const I = {
  bg: "#FFFFFF",
  blue: "#007AFF",
  gray: "#E9E9EB",
  label: "#000000",
  secondary: "#8E8E93",
  tertiary: "#C7C7CC",
  sep: "#C6C6C8",
  fill: "#F2F2F7",
  bar: "#F9F9F9",
  green: "#34C759",
  red: "#FF3B30",
  orange: "#FF9500",
  yellow: "#FFCC00",
  purple: "#AF52DE",
  ink: "#D1D1D6",
};

export function t(size: number, weight: TextStyle["fontWeight"] = "400", color: string = I.label): TextStyle {
  return { fontFamily: SYS, fontSize: size, fontWeight: weight, color, letterSpacing: size >= 20 ? 0.2 : -0.2 };
}

export const OPT = [
  { fg: "#34C759", soft: "#E3F7E8" },
  { fg: "#FF3B30", soft: "#FFE5E3" },
];
export const OPT_MULTI = [
  { fg: "#007AFF", soft: "#E0EEFF" },
  { fg: "#FF9500", soft: "#FFF0DB" },
];
export function optColor(kind: string, i: number) {
  return (kind === "multi" ? OPT_MULTI : OPT)[i] ?? OPT[0];
}
