import type { Page } from '@playwright/test';
export async function auditSurface(page: Page): Promise<{ macLabels: boolean; scrollbars: string[] }> {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('*'));
    const text = [document.body.innerText, ...elements.flatMap(element => [element.title, element.getAttribute('aria-label') || ''])].join(' ');
    const scrollbars = elements.filter(element => {
      const style = getComputedStyle(element), body = getComputedStyle(document.body), viewport = element === document.scrollingElement;
      const overflowing = (/auto|scroll/.test(style.overflowY) || viewport && !/hidden|clip/.test(body.overflowY)) && element.scrollHeight > element.clientHeight + 1 || (/auto|scroll/.test(style.overflowX) || viewport && !/hidden|clip/.test(body.overflowX)) && element.scrollWidth > element.clientWidth + 1;
      if (!overflowing || style.scrollbarWidth === 'none') return false;
      const bar = getComputedStyle(element, '::-webkit-scrollbar');
      if (bar.display === 'none' || bar.width === '0px') return false;
      const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
      const buttons = getComputedStyle(element, '::-webkit-scrollbar-button');
      // The release Web uses shared, theme-painted WebKit thumbs rather than
      // hidden native bars plus a DOM overlay. Both are styled scrollbars.
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!; context.fillStyle = thumb.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const paintedThumb = context.getImageData(0, 0, 1, 1).data[3] > 0;
      const customWidth = /^\d+(?:\.\d+)?px$/.test(bar.width) && parseFloat(bar.width) <= 12;
      const noArrows = buttons.display === 'none' || buttons.width === '0px' && buttons.height === '0px';
      return !(customWidth && paintedThumb && noArrows);
    }).map(element => element.className);
    return { macLabels: /[⌘⌥]/.test(text), scrollbars };
  });
}
