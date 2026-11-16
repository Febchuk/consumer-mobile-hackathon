export const C = {
  paper: "#F7F3EA",
  card: "#FFFDF8",
  ink: "#1E1C19",
  ink2: "#3A3631",
  sub: "#77716A",
  faint: "#B9B2A6",
  line: "#E4DED2",
  rule: "#1E1C19",
  tile: "#ECE6D9",
  yes: "#3E8E5E",
  yesSoft: "#DDEFE2",
  yesDeep: "#2C6B45",
  no: "#D9604C",
  noSoft: "#FBE3DD",
  noDeep: "#A9412F",
  gold: "#E2A93B",
  goldSoft: "#FBEFD3",
  goldDeep: "#9A6B12",
  blue: "#3C7DB8",
  blueSoft: "#DDEAF6",
  flame: "#EE7A2F",
  live: "#2FA866",
};

export const OPTION_COLORS = [
  { fg: C.yes, bg: C.yesSoft, deep: C.yesDeep },
  { fg: C.no, bg: C.noSoft, deep: C.noDeep },
  { fg: C.blue, bg: C.blueSoft, deep: "#285C8C" },
  { fg: C.gold, bg: C.goldSoft, deep: C.goldDeep },
];

export const F = {
  display: "Fraunces_800ExtraBold",
  displaySemi: "Fraunces_600SemiBold",
  body: "InstrumentSans_400Regular",
  bodyMed: "InstrumentSans_600SemiBold",
  bodyBold: "InstrumentSans_700Bold",
  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_800ExtraBold",
};

export const tnum = { fontVariant: ["tabular-nums" as const] };
