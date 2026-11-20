import type { DatabaseSync } from 'node:sqlite';
import type { ParsedUpload } from './detect';
import { planCallsDetail } from './planCalls';
import { planReferenceUpload } from './planReference';
import type { UploadPlan } from './types';

/** Classify an upload against the database (read-only) and add the hints the preview shows. */
export function planUpload(db: DatabaseSync, upload: ParsedUpload): UploadPlan {
  if (upload.kind !== 'calls') return planReferenceUpload(db, upload);

  const { plan, newerBadRows } = planCallsDetail(db, upload);
  const { badByReason, hints } = plan.preview;
  const unknownCampaign = badByReason.unknown_campaign ?? 0;
  const unknownLocation = badByReason.unknown_location ?? 0;
  if (unknownCampaign > 0) {
    hints.push(`${unknownCampaign} rows name a campaign that is not in the database. Upload campaigns.csv first, then upload this file again.`);
  }
  if (unknownLocation > 0) {
    hints.push(`${unknownLocation} rows name an office that is not in the database. Upload locations.csv first, then upload this file again.`);
  }
  if (plan.preview.counts.conflicts > 0) {
    hints.push(`${plan.preview.counts.conflicts} rows have the same call and time as a stored or earlier row but different values. They are not added.`);
  }
  if (newerBadRows > 0) {
    hints.push(`${newerBadRows} bad rows are newer versions of calls already in the database; those calls keep their older, valid version.`);
  }
  return plan;
}
