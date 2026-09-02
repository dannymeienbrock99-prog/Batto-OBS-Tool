"use strict";

function createOverlayDocument(input = {}) {
  return {
    version: 1,
    width: Math.max(1, Number(input.width || 1920)),
    height: Math.max(1, Number(input.height || 1080)),
    elements: Array.isArray(input.elements) ? input.elements.map(normalizeElement) : []
  };
}

function normalizeElement(element = {}) {
  return {
    id: String(element.id || `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    type: String(element.type || "text"),
    x: Number(element.x || 0), y: Number(element.y || 0),
    width: Math.max(1, Number(element.width || 320)), height: Math.max(1, Number(element.height || 80)),
    rotation: Number(element.rotation || 0), zIndex: Number(element.zIndex || 0),
    visible: element.visible !== false,
    locked: element.locked === true,
    props: element.props && typeof element.props === "object" ? { ...element.props } : {}
  };
}

function duplicateElement(document, id) {
  const source = document.elements.find((item) => item.id === id);
  if (!source) return document;
  const copy = normalizeElement({ ...source, id: "", x: source.x + 20, y: source.y + 20, zIndex: source.zIndex + 1 });
  return { ...document, elements: [...document.elements, copy] };
}

function removeElement(document, id) {
  return { ...document, elements: document.elements.filter((item) => item.id !== id) };
}

module.exports = { createOverlayDocument, normalizeElement, duplicateElement, removeElement };
