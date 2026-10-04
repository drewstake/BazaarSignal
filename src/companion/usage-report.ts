import { requestBackend } from '../backend';
import { parseUsageReport } from '../../shared/published-usage';
import type { UsageDashboard } from '../../shared/usage-dashboard';

/** Existing verified-owner backend reads one saved report. It never invokes the
 * private market service, measurements, collection, mail or scheduled work. */
export async function readPublishedUsage(options: {
  token: string; signal?: AbortSignal; backend?: typeof requestBackend;
}) {
  const report = await (options.backend ?? requestBackend)<UsageDashboard>(
    {action:'usage-report'},options.token,options.signal);
  return {...parseUsageReport(JSON.stringify(report)),publishedReport:true};
}
