import QRCode from "qrcode";
import Svg, { Rect } from "react-native-svg";
import { C } from "@/lib/theme";

export function QR({ value, size = 160 }: { value: string; size?: number }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / (n + 2);
  const rects = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (qr.modules.get(x, y)) rects.push(<Rect key={x + "-" + y} x={(x + 1) * cell} y={(y + 1) * cell} width={cell + 0.3} height={cell + 0.3} fill={C.ink} />);
  return (
    <Svg width={size} height={size}>
      <Rect x={0} y={0} width={size} height={size} rx={12} fill="#fff" />
      {rects}
    </Svg>
  );
}
