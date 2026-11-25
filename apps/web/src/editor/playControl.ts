/** The play button before the player holds the project: disabled (and aria-disabled) with its reason as the tooltip; nothing once it does. */
export const playControl = (ready: boolean, reason: string): { disabled?: true; 'aria-disabled'?: true; title?: string } => (ready ? {} : { disabled: true, 'aria-disabled': true, title: reason });
