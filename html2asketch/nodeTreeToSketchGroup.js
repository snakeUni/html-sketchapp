/* eslint padding-line-between-statements: 0 */
import Group from './model/group';
import Style from './model/style';
import nodeToSketchLayers from './nodeToSketchLayers';
import {isNodeVisible} from './helpers/visibility';
import processTransform from './helpers/processTransform';

const pattern = /^('|")\.*\s*('|")$/;
function matches(node, selector) {
  const pseudoElementStyle = getComputedStyle(node, selector);
  const bgColorCheck = pseudoElementStyle.backgroundColor !== 'rgba(0, 0, 0, 0)';
  const content = pseudoElementStyle.content;
  const contentCheck = content && content !== 'none' && !pattern.test(content);
  const borderCheck = parseInt(pseudoElementStyle.borderWidth) > 0 || pseudoElementStyle.borderWidth.indexOf(' ') !== -1;
  const scaleCheck = pseudoElementStyle.transform !== 'matrix(0, 0, 0, 0, 0, 0)';
  return (bgColorCheck || contentCheck || borderCheck) && scaleCheck;
}

export default function nodeTreeToSketchGroup(node, options) {
  const bcr = node.getBoundingClientRect();
  const {left, top} = bcr;
  const width = bcr.right - bcr.left;
  const height = bcr.bottom - bcr.top;

  const styleList = [
    'backgroundColor',
    'backgroundImage',
    'backgroundPositionX',
    'backgroundPositionY',
    'backgroundSize',
    'border',
    'borderTop',
    'borderRight',
    'borderBottom',
    'borderLeft',
    'width',
    'height',
    'borderRadius',
    'fontFamily',
    'fontWeight',
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'color',
    'textTransform',
    'textDecorationLine',
    'textAlign',
    'justifyContent',
    'display',
    'boxShadow',
    'boxSizing',
    'opacity',
    'whiteSpace',
    'padding',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'transform',
    'margin'
  ];
  // 如果为 input 或 textarea 则转 div 元素，value || placeholder 作为其子元素
  if ((node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') && (node.value.trim().length > 0 || node.placeholder.trim().length > 0)) {
    const placeholder = node.value || node.placeholder;
    const newNode = document.createElement('div');
    const styles = getComputedStyle(node);

    styleList.forEach(item => newNode.style[item] = styles[item]);
    newNode.style.color = '#a3a3a3';
    newNode.innerText = placeholder;
    // INPUT 的 placeholder 一定是竖直方向居中
    if (node.tagName === 'INPUT') {
      const paddingTop = parseInt(styles.paddingTop, 10);
      const paddingBottom = parseInt(styles.paddingBottom, 10);
      const lineHeightInt = parseInt(styles.lineHeight, 10);
      const heightInt = parseInt(styles.height, 10);
      const borderWidth = parseInt(styles.borderWidth, 10);
      const fixY = (paddingTop + paddingBottom + lineHeightInt + 2 * borderWidth - heightInt) / 2;
      newNode.style.paddingTop = `${paddingTop - fixY}px`;
    }
    const parentNode = node.parentNode;
    parentNode.replaceChild(newNode, node);
    node = newNode;
  }

  // 如果元素有 伪元素，则将伪元素转换为子元素
  const beforePseudoElementStyle = getComputedStyle(node, ':before');
  const afterPseudoElementStyle = getComputedStyle(node, ':after');
  // 判断是否存在伪元素 :before
  if (matches(node, ':before')) {
    const newNode = document.createElement('div');
    styleList.forEach(item => newNode.style[item] = beforePseudoElementStyle[item]);
    // pseudoElement lineHeight should equal to fontSize
    newNode.style.lineHeight = newNode.style.fontSize;
    newNode.style.height = newNode.style.height !== 'auto' ? newNode.style.height : newNode.style.fontSize;
    newNode.style.width = newNode.style.width !== 'auto' ? newNode.style.width : newNode.style.fontSize;
    // 处理布局
    const content = beforePseudoElementStyle.content;
    if (content && content !== 'none' && !pattern.test(content)) {
      newNode.innerText = content;
    }

    node.classList.add('before-reset');
    node.prepend(newNode);
  }
  // 判断是否存在伪元素 :after
  if (matches(node, ':after')) {
    const newNode = document.createElement('div');
    styleList.forEach(item => newNode.style[item] = afterPseudoElementStyle[item]);
    // pseudoElement lineHeight should equal to fontSize
    newNode.style.lineHeight = newNode.style.fontSize;
    newNode.style.height = newNode.style.height !== 'auto' ? newNode.style.height : newNode.style.fontSize;
    newNode.style.width = newNode.style.width !== 'auto' ? newNode.style.width : newNode.style.fontSize;
    const content = afterPseudoElementStyle.content;
    if (content && content !== 'none' && !pattern.test(content)) {
      newNode.innerText = content;
    }
    node.classList.add('after-reset');
    node.appendChild(newNode);
  }

  // Collect layers for the node level itself
  const layers = nodeToSketchLayers(node, {...options, layerOpacity: false}) || [];

  if (node.nodeName !== 'svg') {
    // Recursively collect child groups for child nodes
    Array.from(node.children)
      .sort((childA, childB) => {
        const childAStyle = getComputedStyle(childA);
        const childBStyle = getComputedStyle(childB);
        if (childAStyle.position === 'absolute') {
          return 1;
        }
        if (childBStyle.position === 'absolute') {
          if (childAStyle.position === 'relative') {
            return 1;
          }
          return -1;
        }
        if (childAStyle.zIndex === childBStyle.zIndex) {
          return 0;
        }
        const zIndexA = parseInt(childAStyle.zIndex);
        const zIndexB = parseInt(childBStyle.zIndex);
        if (!Number.isNaN(zIndexA) && Number.isNaN(zIndexB)) {
          return 1;
        }
        if (Number.isNaN(zIndexA) && !Number.isNaN(zIndexB)) {
          return -1;
        }
        return zIndexA - zIndexB;
      })
      .filter(node => isNodeVisible(node))
      .forEach(childNode => {
        layers.push(nodeTreeToSketchGroup(childNode, options));

        // Traverse the shadow DOM if present
        if (childNode.shadowRoot) {
          Array.from(childNode.shadowRoot.children)
            .filter(node => isNodeVisible(node))
            .map(nodeTreeToSketchGroup)
            .forEach(layer => layers.push(layer));
        }
      });
  }

  // Now build a group for all these children

  const styles = getComputedStyle(node);
  const {opacity} = styles;

  const group = new Group({x: left, y: top, width: styles.width, height: styles.height});
  const groupStyle = new Style();

  if (styles.transform !== 'none') {
    const transform = processTransform({width, height, top, left, right: bcr.right, bottom: bcr.bottom}, styles);
    groupStyle.addTransform(transform);

    // rotation is group's property, not style
    if (transform.rotation) {
      group.setRotation(transform.rotation);
    }
  }

  groupStyle.addOpacity(opacity);
  group.setStyle(groupStyle);
  layers.forEach(layer => {
    // Layer positions are relative, and as we put the node position to the group,
    // we have to shift back the layers by that distance.
    layer._x -= left;
    layer._y -= top;

    group.addLayer(layer);
  });

  // Set the group name to the node's name, unless there is a name provider in the options

  if (options && options.getGroupName) {
    group.setName(options.getGroupName(node));
  } else {
    group.setName(`(${node.nodeName.toLowerCase()})`);
  }

  return group;
}
