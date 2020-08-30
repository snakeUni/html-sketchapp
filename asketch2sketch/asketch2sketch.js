/* eslint padding-line-between-statements: 0 */
import UI from 'sketch/ui';
import {fromSJSONDictionary, toSJSON} from 'sketchapp-json-plugin';
import {fixTextLayer, fixSharedTextStyle} from './helpers/fixFont';
import {SharedStyle} from 'sketch/dom';
import fixImageFillsInLayer from './helpers/fixImageFill';
import fixBitmap from './helpers/fixBitmap';
import fixSVGLayer from './helpers/fixSVG';
import zoomToFit from './helpers/zoomToFit';
import {getDocumentDataFromContext, generateID} from './helpers/utils';
import {resetLayer} from './helpers/resets';

export function removeExistingLayers(context) {
  if (context.containsLayers()) {
    const loop = context.children().objectEnumerator();
    let currLayer = loop.nextObject();

    while (currLayer) {
      if (currLayer !== context) {
        currLayer.removeFromParent();
      }
      currLayer = loop.nextObject();
    }
  }
}

function getNativeLayer(failingLayers, layer) {
  // debug
  // console.log('Processing ' + layer.name + ' (' + layer._class + ')');
  // json stringify to clone new layer
  const newLayer = JSON.parse(JSON.stringify(layer));

  if (newLayer._class === 'text') {
    fixTextLayer(newLayer);
  } else if (newLayer._class === 'svg') {
    fixSVGLayer(newLayer);
  } else if (newLayer._class === 'bitmap') {
    fixBitmap(newLayer);
  } else {
    fixImageFillsInLayer(newLayer);
  }

  // Create native object for the current layer, ignore the children for now
  // this alows us to catch and ignore failing layers and finish the import
  const children = newLayer.layers;
  let nativeObj = null;

  newLayer.layers = [];

  try {
    newLayer.do_objectID = generateID();
    nativeObj = fromSJSONDictionary(newLayer);
  } catch (e) {
    failingLayers.push(newLayer.name);

    console.log('Layer failed to import: ' + newLayer.name);
    return null;
  }

  // Get native object for all child layers and append them to the current object
  if (children && children.length) {
    children.forEach(child => {
      const nativeChild = getNativeLayer(failingLayers, child);

      if (nativeChild) {
        nativeObj.addLayer(nativeChild);
      }
    });
  }

  return nativeObj;
}

function removeSharedTextStyles(document) {
  document.documentData().layerTextStyles().setObjects([]);
}
function removeSharedLayerStyles(document) {
  document.documentData().layerStyles().setObjects([]);
}

function addSharedTextStyle(document, style) {
  const container = context.document.documentData().layerTextStyles();

  if (container.addSharedStyleWithName_firstInstance) {
    container.addSharedStyleWithName_firstInstance(style.name, fromSJSONDictionary(style.value));
  } else {
    let sharedStyle;
    const allocator = MSSharedStyle.alloc();

    if (allocator.initWithName_firstInstance) {
      sharedStyle = allocator.initWithName_firstInstance(style.name, fromSJSONDictionary(style.value));
    } else {
      sharedStyle = allocator.initWithName_style(style.name, fromSJSONDictionary(style.value));
    }
    container.addSharedObject(sharedStyle);
  }
}

function addSharedLayerStyle(document, {name, style}) {
  SharedStyle.fromStyle({
    name,
    style: fromSJSONDictionary(style),
    document,
  });
}

function removeSharedColors(document) {
  const assets = document.documentData().assets();

  assets.removeAllColorAssets();
}

function addSharedColor(document, colorJSON) {
  const assets = document.documentData().assets();
  const color = fromSJSONDictionary(colorJSON);

  assets.addAsset(color);
}

// registor symbol master
const symbolsRegistry = {};
// let hasInitialized = false;
let existingSymbols = [];

const getSymbolsPage = documentData => documentData.symbolsPageOrCreateIfNecessary();

const msListToArray = pageList => {
  const out = [];
  // eslint-disable-next-line
  for (let i = 0; i < pageList.length; i++) {
    out.push(pageList[i]);
  }
  return out;
};

const getDocumentData = document => {
  let nativeDocumentData = '';
  if (document && document.sketchObject) {
    const nativeDocument = document.sketchObject;
    nativeDocumentData = nativeDocument.documentDat ? nativeDocument.documentData() : nativeDocument;
  } else if (document) {
    if (document.documentData) {
      nativeDocumentData = document.documentData();
    } else {
      nativeDocumentData = document;
    }
  } else {
    nativeDocumentData = getDocumentDataFromContext(context); // eslint-disable-line
  }
  // $FlowFixMe
  return nativeDocumentData;
};

const getExistingSymbols = documentData => {
  // if (!hasInitialized) {
  //   hasInitialized = true;
  // }
  const symbolsPage = getSymbolsPage(documentData);
  existingSymbols = msListToArray(symbolsPage.layers()).map(x => {
    const symbolJson = JSON.parse(toSJSON(x));
    return symbolJson;
  });
  existingSymbols.forEach(symbolMaster => {
    if (symbolMaster._class !== 'symbolMaster') {
      return;
    }
    if (symbolMaster.symbolID in symbolsRegistry) {
      return;
    }
    symbolsRegistry[symbolMaster.symbolID] = symbolMaster;
  });
  return existingSymbols;
};

export const renderLayers = (layers, container) => {
  if (container.addLayers === undefined) {
    throw new Error(`
     React SketchApp cannot render into this layer. You may be trying to render into a layer
     that does not take children. Try rendering into a LayerGroup, Artboard, or Page.
    `);
  }

  container.addLayers(layers);
  return container;
};

const injectSymbols = (document, symbolIDs) => {
  const documentData = getDocumentData(document);

  // if hasInitialized is false then makeSymbol has not yet been called
  // if (!hasInitialized) {
  // }
  // every time need getExistingSymbols
  getExistingSymbols(documentData);

  const symbolsPage = getSymbolsPage(documentData);

  let left = 0;
  Object.keys(symbolsRegistry).forEach(key => {
    const symbolMaster = symbolsRegistry[key];
    symbolMaster.frame.y = 0;
    symbolMaster.frame.x = left;
    left += parseInt(symbolMaster.frame.width) + 20;
  });

  // add
  let symbolLayers = [];
  if (symbolIDs) {
    symbolLayers = symbolIDs.map(k => symbolsRegistry[k]);
  } else {
    // Clear out page layers to prepare for re-render
    resetLayer(symbolsPage);

    symbolLayers = Object.keys(symbolsRegistry).map(k => symbolsRegistry[k]);
  }
  render(symbolLayers, symbolsPage);
};

export const renderSymbol = (symbolMaster, symbolInstance, container, document) => {
  if (!symbolsRegistry[symbolMaster.symbolID]) {
    symbolsRegistry[symbolMaster.symbolID] = symbolMaster;
    // inject symbol master
    injectSymbols(document, [symbolMaster.symbolID]);
  }
  return render([symbolInstance], container);
};

export const registorSymbolMaster = (symbolMasters, document) => {
  const symbolMasterIDs = [];
  symbolMasters.forEach(symbolMaster => {
    const symbolID = symbolMaster.symbolID;
    if (!symbolsRegistry[symbolID]) {
      symbolsRegistry[symbolID] = symbolMaster;
      symbolMasterIDs.push(symbolID);
    }
  });
  // inject symbol master
  injectSymbols(document, symbolMasterIDs);
};

export const render = (layers, container) => {
  const failingLayers = [];
  layers
    .map(getNativeLayer.bind(null, failingLayers))
    .forEach(layer => layer && container.addLayer(layer));
  return container;
};

export default function asketch2sketch(context, asketchFiles) {
  const document = context.document;
  const page = document.currentPage();

  let asketchDocument = null;
  let asketchPage = null;

  asketchFiles.forEach(asketchFile => {
    if (asketchFile && asketchFile._class === 'document') {
      asketchDocument = asketchFile;
    } else if (asketchFile && asketchFile._class === 'page') {
      asketchPage = asketchFile;
    }
  });

  if (asketchDocument) {
    if (options && options.removeSharedStyles) {
      removeSharedColors(document);
      removeSharedTextStyles(document);
      removeSharedLayerStyles(document);
    }

    if (asketchDocument.assets.colors) {
      asketchDocument.assets.colors.forEach(color => addSharedColor(document, color));

      console.log(`Shared colors added: ${asketchDocument.assets.colors.length}`);
    }

    if (asketchDocument.layerTextStyles && asketchDocument.layerTextStyles.objects) {
      asketchDocument.layerTextStyles.objects.forEach(style => {
        fixSharedTextStyle(style);
        addSharedTextStyle(document, style);
      });

      console.log(`Shared text styles added: ${asketchDocument.layerTextStyles.objects.length}`);
    }
    if (asketchDocument.layerStyles && asketchDocument.layerStyles.objects) {
      asketchDocument.layerStyles.objects.forEach(sharedStyle => {
        addSharedLayerStyle(document, sharedStyle);
      });

      console.log(`Shared layer styles added: ${asketchDocument.layerStyles.objects.length}`);
    }
  }

  if (asketchPage) {
    // removeExistingLayers(page);

    // page.name = asketchPage.name;
    const failingLayers = [];

    let maxX = 0;
    let yPosition = 0;
    if (page.layers().length) {
      const sortedLayers = page.layers().sort((layerA, layerB) => layerB.frame().x() - layerA.frame().x());
      const lastLayer = sortedLayers[0];
      maxX = lastLayer.frame().x() + lastLayer.frame().width();
      yPosition = lastLayer.frame().y();
    }
    asketchPage.layers
      .map(getNativeLayer.bind(null, failingLayers))
      .forEach(layer => {
        if (layer) {
          layer.frame().x = maxX + 100;
          layer.frame().y = yPosition;
          maxX = layer.frame().x() + layer.frame().width();
          page.addLayer(layer);
        }
      });

    if (failingLayers.length === 1) {
      UI.alert('asketch2sketch', 'One layer couldn\'t be imported and was skipped.');
    } else if (failingLayers.length > 1) {
      UI.alert('asketch2sketch', `${failingLayers.length} layers couldn't be imported and were skipped.`);
    } else {
      const emojis = ['👌', '👍', '✨', '😍', '🍾', '🤩', '🎉', '👏', '💪', '🤘', '💅', '🏆', '🚀'];

      UI.message(`Import successful ${emojis[Math.floor(emojis.length * Math.random())]}`);
    }

    zoomToFit(context);
  }
}
