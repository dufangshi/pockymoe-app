import type { Page } from '@playwright/test';
export async function auditSurface(page: Page): Promise<{ macLabels: boolean; scrollbars: string[] }> {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('*'));
    const text = [document.body.innerText, ...elements.flatMap(element => [element.title, element.getAttribute('aria-label') || ''])].join(' ');
    const scrollbars = elements.filter(element => {
      const style = getComputedStyle(element), body = getComputedStyle(document.body), viewport = element === document.scrollingElement;
      const overflowing = (/auto|scroll/.test(style.overflowY) || viewport && !/hidden|clip/.test(body.overflowY)) && element.scrollHeight > element.clientHeight + 1 || (/auto|scroll/.test(style.overflowX) || viewport && !/hidden|clip/.test(body.overflowX)) && element.scrollWidth > element.clientWidth + 1;
      return overflowing && style.scrollbarWidth !== 'none' && getComputedStyle(element, '::-webkit-scrollbar').display !== 'none';
    }).map(element => element.className);
    return { macLabels: /[⌘⌥]/.test(text), scrollbars };
  });
}
