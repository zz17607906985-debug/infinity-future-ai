const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'delivery', 'provenance.js'), 'utf8');
const context = {window: {}, Date, Math, JSON};
vm.createContext(context);
vm.runInContext(source, context);
const api = context.window.FutureAIProvenance;

const data = {};
api.recordNodeOutputs(data, [{url: 'file:///a.png', mediaType: 'image', modelId: 'm1', references: [{url: 'secret', role: 'character', sourceNodeId: 'n1'}]}]);
if (data.provenanceRecords.length !== 1) throw new Error('output provenance was not recorded');
if ('url' in data.provenanceRecords[0].references[0]) throw new Error('reference URL leaked into provenance reference');
api.updateApproval(data, 'file:///a.png', 'approved', 'batch-1');
data.approval = {status: 'approved', outputUrl: 'file:///a.png'};
api.addTransformation(data, 'file:///a.png', {kind: 'resize', from: '1:1', to: '16:9'});
if (data.provenanceRecords[0].approvalStatus !== 'invalidated') throw new Error('edited approval was not invalidated');
if (data.approval.status !== 'invalidated') throw new Error('node approval was not invalidated after transformation');
data.approval = {status: 'approved', outputUrl: 'file:///a.png'};
api.recordNodeOutputs(data, [{url: 'file:///b.png', mediaType: 'image'}]);
if (data.approval.status !== 'invalidated') throw new Error('node approval was not invalidated after a new output');
const manifest = api.manifestFromNodes([{id: 'n1', type: 'image', data}]);
const transformed = manifest.find(item => item.url === 'file:///a.png');
if (!transformed || transformed.nodeId !== 'n1' || transformed.transformations.length !== 1) throw new Error('manifest is incomplete');
console.log('Provenance tests passed.');
