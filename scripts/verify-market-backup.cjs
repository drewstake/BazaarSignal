const crypto = require('node:crypto');
const project = 'bazaarsignal-510305';
const snapshots = ['auctions', 'bazaar', 'catalog', 'election'];
const documentIds = [...snapshots, 'control', 'player-names'].sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function verifyMarketBackup({ manifest, documents, containment, readFile, now = Date.now() }) {
  const pausedAt = Date.parse(containment?.at), backedUpAt = Date.parse(manifest?.at);
  if (![now, pausedAt, backedUpAt].every(Number.isFinite) || backedUpAt < pausedAt || backedUpAt > now || now - pausedAt < 240000)
    throw new Error('Invalid backup/pause timestamp or in-flight work has not drained');
  if (containment.project !== project || containment.jobState !== 'PAUSED' || manifest.project !== project ||
      !Array.isArray(manifest.collections) || !same(manifest.collections, ['marketCache']))
    throw new Error('Unexpected backup project, collection or containment state');
  if (!Array.isArray(manifest.files) || !same(manifest.files.map(f => f.file), snapshots.map(id => `${id}.json.gz`)))
    throw new Error('Backup must contain four distinct current snapshots');
  if (documents.nextPageToken || !Array.isArray(documents.documents) ||
      !same(documents.documents.map(d => d.name), documentIds.map(id => `projects/${project}/databases/(default)/documents/marketCache/${id}`)))
    throw new Error('Incomplete or unexpected cache document backup');
  for (const doc of documents.documents) {
    const updatedAt = Date.parse(doc.updateTime);
    if (!Number.isFinite(updatedAt) || updatedAt > backedUpAt) throw new Error('Invalid cache document timestamp');
  }
  const control = documents.documents.find(d => d.name.endsWith('/control'));
  const total = JSON.parse(control.fields.value.stringValue).totalRequests;
  if (!Number.isSafeInteger(total) || total < 0 || total !== manifest.totalHypixelRequests)
    throw new Error('Request ledger does not match the backup manifest');
  JSON.parse(documents.documents.find(d => d.name.endsWith('/player-names')).fields.value.stringValue);
  for (const file of manifest.files) {
    const id = file.file.slice(0, -8);
    const pointer = documents.documents.find(d => d.name.endsWith(`/${id}`));
    if (pointer.fields.blob.stringValue !== file.source) throw new Error('Snapshot does not match its saved pointer');
    const bytes = readFile(file.file);
    if (bytes.length !== file.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error('Snapshot backup integrity failed');
  }
  return { project, documents: documents.documents.length, snapshots: manifest.files.length, totalHypixelRequests: total };
}
module.exports = { verifyMarketBackup };
