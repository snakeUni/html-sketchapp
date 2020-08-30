/* eslint padding-line-between-statements: 0 */
import {isNativeDocument, isNativeSymbolsPage} from './utils';

export const resetLayer = container => {
  if (isNativeDocument(container)) {
    resetDocument(container); // eslint-disable-line
    return;
  }
  const layers = container.children();
  // Skip last child since it is the container itself
  for (let l = 0; l < layers.count() - 1; l += 1) {
    const layer = layers.objectAtIndex(l);
    layer.removeFromParent();
  }
};

export const resetDocument = documentData => {
  // Get Pages and delete them all (Except Symbols Page)
  const pages = documentData.pages();
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    // Don't delete symbols page
    if (!isNativeSymbolsPage(page)) {
      if (pages.length > 1) {
        documentData.removePageAtIndex(index);
      } else {
        resetLayer(page);
      }
    }
  }
};
