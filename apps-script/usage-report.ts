import { readDoc } from './store';
import { ownerUsagePath, parseUsageReport, USAGE_OWNER_EMAIL } from '../shared/published-usage';

/** The identity was verified by accounts:lookup in doPost. The legacy datastore
 * owner ID is a storage location, not the current reporting user's identity. */
export function readOwnerUsageReport(identity: {uid:string;email:string}) {
  if(identity.email!==USAGE_OWNER_EMAIL)throw new Error('Usage report: owner access required.');
  const access=readDoc('config/access');
  const document=readDoc(ownerUsagePath(access?.fields?.ownerUid?.stringValue ?? ''));
  if(!document)throw new Error('Usage report: no measurements have been published yet.');
  if(document.fields?.schema?.integerValue!=='1')throw new Error('Usage report: saved report is invalid.');
  return {...parseUsageReport(document.fields.json?.stringValue),publishedReport:true};
}
