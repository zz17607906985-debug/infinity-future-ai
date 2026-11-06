const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'export', 'batch-export-payload.js'), 'utf8');
const context = {window: {}, JSON};
vm.createContext(context);
vm.runInContext(source, context);
const api = context.window.FutureAIBatchExportPayload;
const node = {id: 'n1', type: 'image', data: {url: 'old.png', urls: ['old.png'], variants: [{url: 'a.png', status: 'candidate'}, {url: 'b.png', status: 'approved'}], provenanceRecords: [{url: 'a.png'}, {url: 'b.png'}]}};
const delivered = api.prepareNodeForDelivery(node);
if (delivered.data.url !== 'b.png' || delivered.data.variants.length !== 1 || delivered.data.provenanceRecords.length !== 1) throw new Error('unapproved variants entered delivery');
const blocked = api.prepareNodeForDelivery({data: {url: 'a.png', variants: [{url: 'a.png', status: 'candidate'}]}});
if (!blocked.data.deliveryBlocked || blocked.data.url) throw new Error('unapproved-only node was not blocked');
console.log('Batch delivery tests passed.');
