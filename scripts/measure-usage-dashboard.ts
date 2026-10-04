// Operator read-only diagnostic. Outputs no credentials or private user records.
import { writeFileSync } from 'node:fs';
import { createLocalUsageReport } from '../server/local-usage';
const result=await createLocalUsageReport()();
writeFileSync('.local/usage-dashboard-measured.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({at:result.generatedAt,collection:result.collection,rows:result.rows.map(r=>({id:r.id,state:r.state,measured:r.measured,at:r.measuredAt,projected:r.projected}))},null,2));
