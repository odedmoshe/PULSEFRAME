/** Requests that one part of the editor makes of another to put the keyboard focus where only the other part knows how to draw it. */
/** The AI hub asks the inspector to show its review panel and focus the first approval (the inspector gives the focus in the commit that draws it). */
export const FOCUS_APPROVALS_EVENT = 'pf:focus-approvals';
export const requestApprovalsFocus = (): void => { window.dispatchEvent(new Event(FOCUS_APPROVALS_EVENT)); };
