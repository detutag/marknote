import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { buildSanitizeSchema, isDataImageUrl, makeMarkdownUrlTransform } from '../../lib/media.js';

const urlTransform = makeMarkdownUrlTransform(defaultUrlTransform);
const render = (md) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { rehypePlugins: [rehypeRaw, [rehypeSanitize, buildSanitizeSchema()]], urlTransform },
      md,
    ),
  );

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('isDataImageUrl：只認常見圖片類型', () => {
  assert.equal(isDataImageUrl(PNG), true);
  assert.equal(isDataImageUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isDataImageUrl('https://example.com/a.png'), false);
});

test('Markdown 圖片與 <img> 都能顯示 data:image', () => {
  assert.match(render(`![x](${PNG})`), new RegExp(`src="${PNG.replace(/[+/.]/g, '\\$&')}"`));
  assert.match(render(`<img src="${PNG}" alt="x">`), /src="data:image\/png/);
});

test('data: 網址不會出現在 img 以外的標籤', () => {
  const html = render(
    `<video src="${PNG}"></video>\n\n<iframe src="data:text/html;base64,PHNjcmlwdD4="></iframe>\n\n<img src="data:text/html;base64,PHNjcmlwdD4=">`,
  );
  assert.doesNotMatch(html, /data:/);
});

test('一般 http/https 與站内相對網址照常保留', () => {
  assert.match(render('![a](https://example.com/a.png)'), /src="https:\/\/example.com\/a.png"/);
  assert.match(render('![a](/api/files/1/raw)'), /src="\/api\/files\/1\/raw"/);
});
