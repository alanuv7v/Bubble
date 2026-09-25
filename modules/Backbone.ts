import backbone from '../src/backbone.ts';
import tags from '../src/tags.ts';
import { cr } from '../src/utils/gui.ts'
//@ts-expect-error
import htmlString from './start.html?raw';

export function render (): HTMLElement {
  return tags.div(`backbone: ${backbone()}`)
}

export const config = {
  // whatever goes here
}