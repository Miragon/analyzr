import { useState } from 'react';

import { CANVAS_WIDE, useMediaQuery } from './media';

/** The collapsed sheet's height: its handle (UX-SIMPLIFICATION.md §3.13 item 1). */
export const SHEET_HANDLE = '3.25rem';
/** The expanded sheet's height. */
export const SHEET_HEIGHT = '60dvh';

export interface CanvasSheet {
  /** From 1024 px: an aside, no sheet. */
  wide: boolean;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  /** The canvas container's bottom inset: 0 wide, the handle collapsed, the sheet expanded. */
  inset: string;
}

/** The sheet state of a canvas page (one per page), for `CanvasPanel` and the canvas inset. */
export function useCanvasSheet(): CanvasSheet {
  const wide = useMediaQuery(CANVAS_WIDE);
  const [expanded, setExpanded] = useState(false);
  return {
    wide,
    expanded,
    setExpanded,
    inset: wide ? '0px' : expanded ? SHEET_HEIGHT : SHEET_HANDLE,
  };
}
