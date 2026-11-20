export const playbarSelector = '[data-testid="now-playing-bar"], .Root__now-playing-bar';
const mappedControls = ".main-nowPlayingBar-extraControls, .now-playing-bar-extra-controls";

export const nativeFullscreenButton = 'button[data-testid="fullscreen-mode-button"]';

const nativeControls = [
  nativeFullscreenButton,
  'button[data-testid="pip-toggle-button"]',
  'button[data-testid="lyrics-button"]',
  'button[data-testid="control-button-npv"]:not([data-spotify-plus-disable-peek])',
].join(", ");

export function findPlaybarControls() {
  const playbar = document.querySelector(playbarSelector);
  // The Queue button can sit inside a wrapper, so find the group that contains it.
  return playbar?.querySelector<HTMLElement>(`:has(> :is(${nativeControls})):has(button[data-testid="control-button-queue"])`)
    ?? playbar?.querySelector<HTMLElement>(mappedControls)
    ?? playbar?.querySelector(nativeControls)?.parentElement
    ?? document.querySelector<HTMLElement>(mappedControls);
}
