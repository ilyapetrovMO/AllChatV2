// Captures editable SVG primitives at the catalog viewport. Imported text still needs native conversion.
export async function captureVector(page, {fullPage = false} = {}) {
  return page.evaluate(async fullPage => {
    const width = fullPage ? Math.max(innerWidth, document.documentElement.scrollWidth) : innerWidth;
    const height = fullPage ? Math.max(innerHeight, document.documentElement.scrollHeight) : innerHeight;
    const imageData = new Map(), missingImages = [];
    await Promise.all([...document.images].map(async img => {
      if (!img.complete || !img.naturalWidth) return;
      try {
        const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        try {canvas.getContext('2d').drawImage(img,0,0);imageData.set(img,canvas.toDataURL('image/png'));return;} catch {}
        const response = await fetch(img.currentSrc || img.src);
        if (!response.ok) throw Error('Image unavailable');
        const blob = await response.blob();
        const data = await new Promise((resolve,reject) => {const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
        imageData.set(img,data);
      } catch {missingImages.push(img.alt || 'Unlabelled image');}
    }));
    const primitives = [];
    const xml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[char]));
    const number = value => Math.round(value * 100) / 100;
    const visible = box => box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < height && box.left < width;
    const identify = element => element.id && !element.id.startsWith('message-') ? `#${element.id}` : `${element.tagName.toLowerCase()}${Array.from(element.classList).map(name => `.${name}`).join('')}`;
    const parts = [];
    function visit(element) {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      if (style.display === 'contents') { for (const child of element.children) visit(child); return; }
      if (!visible(box)) return;
      const name = identify(element);
      if (['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT'].includes(element.tagName)) return;
      const x = number(box.x), y = number(box.y), width = number(box.width), height = number(box.height);
      parts.push(`<g id="layer-${parts.length}" aria-label="${xml(name)}">`);
      if (element instanceof SVGElement) {
        const clone = element.cloneNode(true);
        const originals = [element, ...element.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
        originals.forEach((node, index) => {
          const css = getComputedStyle(node);
          for (const key of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight']) copies[index].setAttribute(key, css.getPropertyValue(key));
        });
        clone.setAttribute('x', x); clone.setAttribute('y', y); clone.setAttribute('width', width); clone.setAttribute('height', height);
        // Read chart labels in viewport coordinates before removing their SVG
        // transforms. This also resolves inherited font sizes and text anchors.
        const labels = [...element.querySelectorAll('text')].map(node => {
          const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
          const matrix = node.getScreenCTM();
          const scale = matrix ? Math.hypot(matrix.c, matrix.d) : 1;
          return {value: node.textContent, rect, css, size: parseFloat(css.fontSize) * scale};
        });
        clone.querySelectorAll('text').forEach(node => node.remove());
        parts.push(new XMLSerializer().serializeToString(clone));
        for (const label of labels) {
          if (!visible(label.rect)) continue;
          parts.push(`<text x="${number(label.rect.x)}" y="${number(label.rect.y + label.size)}" font-family="${xml(label.css.fontFamily)}" font-size="${label.size}" font-weight="${label.css.fontWeight}" fill="${xml(label.css.fill)}">${xml(label.value)}</text>`);
        }
        parts.push('</g>');
        return;
      }
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(style.borderTopWidth)) {
        const radius = parseFloat(style.borderTopLeftRadius) || 0;
        parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${xml(style.backgroundColor)}" stroke="${xml(style.borderTopColor)}" stroke-width="${parseFloat(style.borderTopWidth) || 0}"/>`);
      }
      if (element instanceof HTMLImageElement && imageData.has(element)) {
        const aspect = style.objectFit === 'fill' ? 'none' : style.objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
        parts.push(`<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${aspect}" href="${xml(imageData.get(element))}"/>`);
      }
      primitives.push({selector: name, x, y, width, height, color: style.color, background: style.backgroundColor, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, radius: style.borderTopLeftRadius, padding: style.padding, gap: style.gap});
      function text(value, left, top, css) {
        parts.push(`<text x="${number(left)}" y="${number(top + parseFloat(css.fontSize))}" font-family="${xml(css.fontFamily)}" font-size="${css.fontSize}" font-weight="${css.fontWeight}" fill="${xml(css.color)}">${xml(value)}</text>`);
      }
      const before = getComputedStyle(element, '::before');
      if (before.content && !['none', 'normal', '""'].includes(before.content) && /^".*"$/.test(before.content)) {
        text(before.content.slice(1, -1), x + parseFloat(style.paddingLeft), y + (height - parseFloat(before.fontSize)) / 2, before);
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const displayedValue = element instanceof HTMLInputElement && element.type === 'password'
          ? '•'.repeat(element.value.length)
          : element.value;
        text(displayedValue || element.placeholder, x + parseFloat(style.paddingLeft), y + parseFloat(style.paddingTop), element.value ? style : getComputedStyle(element, '::placeholder'));
      }
      for (const child of element.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) visit(child);
        else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
          const range = document.createRange();
          // Preserve browser line wrapping as separately editable text runs.
          let line = '', lineBox;
          for (let i = 0; i < child.textContent.length; i++) {
            range.setStart(child, i); range.setEnd(child, i + 1);
            const rect = range.getBoundingClientRect();
            if (lineBox && Math.abs(rect.top - lineBox.top) > 2) { text(line, lineBox.x, lineBox.y, style); line = ''; lineBox = undefined; }
            if (!lineBox && rect.width > 0) lineBox = rect;
            line += child.textContent[i];
          }
          if (lineBox) text(line, lineBox.x, lineBox.y, style);
        }
      }
      parts.push('</g>');
    }
    visit(document.body);
    const css = getComputedStyle(document.documentElement);
    const variables = Object.fromEntries(Array.from(css).filter(name => name.startsWith('--')).map(name => [name, css.getPropertyValue(name).trim()]));
    return {svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`, primitives, variables, width, height, embeddedImages:imageData.size, missingImages};
  }, fullPage);
}
