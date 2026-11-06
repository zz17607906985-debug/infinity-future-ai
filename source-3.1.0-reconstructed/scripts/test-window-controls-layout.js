'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const director = fs.readFileSync(path.join(root, 'src', 'director-desk', 'index.html'), 'utf8');

assert.match(styles, /--window-controls-safe-width:148px/);
assert.match(styles, /\.topbar>\.top-actions[\s\S]*?right:calc\(20px \+ var\(--window-controls-safe-width\)\)!important/);
assert.match(director, /--window-controls-safe-width: 148px/);
assert.match(director, /\.top-bar \{[\s\S]*?padding-right: calc\(20px \+ var\(--window-controls-safe-width\)\)/);
assert.match(director, /\.top-bar button,[\s\S]*?-webkit-app-region: no-drag/);

console.log('Window controls safe-area layout tests passed.');
assert.doesNotMatch(styles, /.short-heads+divs*{/);
assert.doesNotMatch(styles, /.short-panel-head>divs*{/);
assert.match(styles, /.short-head>.manju-titles*{/);
assert.match(styles, /#shortProductionStatus{[^}]*flex-flow:row wrap/);
assert.match(styles, /.manju-head{[^}]*flex:0 0 auto!important/);
assert.match(styles, /.music-player{[^}]*grid-template-rows:auto!important/);
console.log('Header flow and media player layout regression contracts passed.');
const canvasEnd = markup.indexOf('</section>', markup.indexOf('<section id="canvas"'));
assert.ok(markup.indexOf('id="historyDrawer"') > canvasEnd, 'History drawer must not be trapped inside the canvas stacking context');
assert.ok(markup.indexOf('id="queueDrawer"') > canvasEnd, 'Queue drawer must not be trapped inside the canvas stacking context');
