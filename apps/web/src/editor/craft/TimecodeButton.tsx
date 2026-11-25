/**
 * The transport timecode (Transport.tsx). W3 turns it into the button that opens «מעבר לזמן» (G) and keeps
 * data-testid="timecode". In the pre-pass it renders exactly what Transport.tsx rendered before.
 */
export function TimecodeButton({ text }: { text: string }) {
  return <span className="timecode tc" data-testid="timecode">{text}</span>;
}
